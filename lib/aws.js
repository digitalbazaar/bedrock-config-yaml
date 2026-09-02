/*!
 * Copyright (c) 2026 Digital Bazaar, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as bedrock from '@bedrock/core';
import {decryptEnvelope, parseEnvelope} from './envelope.js';
import {logger} from './logger.js';

const {config, util: {BedrockError}} = bedrock;

const MAX_WAIT_MS = 300000;
const RETRYABLE_ERROR_NAMES = {
  kms_decrypt: new Set([
    'CredentialsProviderError', 'NetworkError', 'NotAllowedError',
    'TimeoutError'
  ]),
  region_discovery: new Set([
    'CredentialsProviderError', 'NetworkError', 'NotFoundError',
    'TimeoutError'
  ]),
  secret_fetch: new Set([
    'CredentialsProviderError', 'NetworkError', 'NotAllowedError',
    'NotFoundError', 'TimeoutError'
  ]),
  // EC2 instance tags exposed through IMDS are eventually consistent during
  // boot; discovery failures must be retryable like the other dependencies
  secret_id_discovery: new Set([
    'NetworkError', 'NotFoundError', 'TimeoutError'
  ])
};

export function getAwsSource() {
  const source = config['config-yaml'].sources?.aws;
  if(source === undefined) {
    return null;
  }
  if(!_isObject(source)) {
    throw new BedrockError(
      'The AWS bedrock config source is invalid.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false
      });
  }
  if(source.enabled !== true) {
    return null;
  }
  if(typeof source.secretIdTag !== 'string' ||
    source.secretIdTag.length === 0) {
    throw new BedrockError(
      'The AWS bedrock config SecretId tag is invalid.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false
      });
  }
  if(source.environment !== 'nitro') {
    throw new BedrockError(
      'The configured AWS bedrock config environment is not implemented.',
      'NotSupportedError', {
        httpStatusCode: 501,
        public: false,
        environment: source.environment ?? null,
        supportedEnvironments: ['nitro']
      });
  }
  return source;
}

export async function readConfigFromAws() {
  const source = getAwsSource();
  const {
    getClient, getDefaultRegion, getEc2InstanceTag,
    GetSecretValueCommand, SecretsManagerClient
  } = await _loadAwsModules();
  const kmsClient = getClient({name: 'config-yaml'});
  const startedAt = Date.now();
  const deadline = startedAt + MAX_WAIT_MS;
  let delay = 5000;
  let attempt = 0;
  let region;
  let secretsClient;
  // discovered inside the retry loop; the instance tag may not be visible
  // in IMDS on the first attempts after boot
  let secretId;

  logger.info('AWS bedrock config load started', {
    secretIdTag: source.secretIdTag,
    maxWaitSeconds: MAX_WAIT_MS / 1000
  });

  try {
    while(true) {
      attempt += 1;
      let stage = 'region_discovery';
      try {
        region ??= await getDefaultRegion();
        secretsClient ??= new SecretsManagerClient({region});

        stage = 'secret_id_discovery';
        secretId ??= await _getSecretId({
          getEc2InstanceTag, secretIdTag: source.secretIdTag
        });

        stage = 'secret_fetch';
        const envelope = await _fetchEnvelope({
          client: secretsClient,
          command: new GetSecretValueCommand({SecretId: secretId}),
          secretId,
          region
        });

        stage = 'kms_decrypt';
        const {plaintext: dataKey} = await kmsClient.decryptWithAttestation({
          ciphertext: envelope.encryptedDataKey,
          // KMS enforces that the ciphertext was produced under the
          // envelope-declared key instead of inferring the key from the blob
          keyId: envelope.kmsKeyId
        });

        stage = 'envelope_decrypt';
        let plaintext;
        try {
          plaintext = decryptEnvelope({envelope, key: dataKey});
        } finally {
          dataKey.fill(0);
        }

        logger.info('AWS bedrock config loaded', {
          attempt,
          region,
          secretId,
          envelopeVersion: envelope.version,
          kmsKeyId: envelope.kmsKeyId,
          plaintextSha256: envelope.plaintextSha256
        });
        const configText = new TextDecoder().decode(plaintext);
        // best effort only; the decoded string itself persists in JS memory
        plaintext.fill(0);
        return configText;
      } catch(error) {
        const retryable = _isRetryable({stage, error});
        const remaining = deadline - Date.now();
        if(!retryable) {
          throw error;
        }
        if(remaining <= 0) {
          throw new BedrockError(
            'Bedrock config did not become ready before the deadline.',
            'TimeoutError', {
              httpStatusCode: 504,
              public: false,
              dependencyStage: stage,
              errorName: error.name,
              attempt,
              maxWaitSeconds: MAX_WAIT_MS / 1000,
              cause: error
            });
        }
        const wait = Math.min(delay, remaining);
        logger.warn('AWS bedrock config dependency is not ready', {
          attempt,
          dependencyStage: stage,
          errorName: error.name,
          retryInMs: wait
        });
        await new Promise(resolve => setTimeout(resolve, wait));
        delay = Math.min(delay * 2, 60000);
      }
    }
  } finally {
    secretsClient?.destroy();
  }
}

async function _getSecretId({getEc2InstanceTag, secretIdTag}) {
  const secretId = await getEc2InstanceTag({name: secretIdTag});
  if(!secretId) {
    throw new BedrockError(
      'The EC2 instance SecretId tag is empty.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false,
        secretIdTag
      });
  }
  return secretId;
}

async function _fetchEnvelope({client, command, secretId, region}) {
  let response;
  try {
    response = await client.send(command);
  } catch(error) {
    const common = {
      secretId,
      region,
      awsErrorName: error.name,
      awsRequestId: error.$metadata?.requestId ?? null
    };
    if(error.name === 'ResourceNotFoundException') {
      throw new BedrockError(
        'The bedrock config secret was not found.',
        'NotFoundError', {
          ...common,
          httpStatusCode: 404,
          public: false,
          cause: error
        });
    }
    if(error.name === 'AccessDeniedException' ||
      error.name === 'AccessDenied') {
      throw new BedrockError(
        'Access to the bedrock config secret was denied.',
        'NotAllowedError', {
          ...common,
          httpStatusCode: 403,
          public: false,
          cause: error
        });
    }
    // The AWS SDK already retries service and transport failures. Preserve an
    // exhausted or unexpected error instead of guessing that it is transient.
    throw error;
  }

  if(typeof response.SecretString !== 'string') {
    throw new BedrockError(
      'The bedrock config secret did not contain SecretString.',
      'DataError', {
        httpStatusCode: 500,
        public: false,
        secretId,
        region,
        secretVersionId: response.VersionId ?? null
      });
  }

  return parseEnvelope(response.SecretString);
}

async function _loadAwsModules() {
  let awsKms;
  let secretsManager;
  try {
    [awsKms, secretsManager] = await Promise.all([
      import('@bedrock/aws-kms'),
      import('@aws-sdk/client-secrets-manager')
    ]);
  } catch(cause) {
    if(cause.code !== 'ERR_MODULE_NOT_FOUND') {
      throw cause;
    }
    throw new BedrockError(
      'The AWS bedrock config source requires "@bedrock/aws-kms" and ' +
      '"@aws-sdk/client-secrets-manager" to be installed.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false,
        cause
      });
  }

  config['aws-kms'].clients['config-yaml'] ??= {};
  return {...awsKms, ...secretsManager};
}

export function _isRetryable({stage, error}) {
  if(RETRYABLE_ERROR_NAMES[stage]?.has(error.name)) {
    return true;
  }
  // AWS SDK v3 marks exhausted transport and throttling failures as
  // retryable. Limit this fallback to AWS client stages so malformed
  // envelopes and other permanent application errors still fail fast.
  if(stage === 'secret_fetch' || stage === 'kms_decrypt') {
    const status = error.$metadata?.httpStatusCode;
    return error.$retryable !== undefined || status >= 500;
  }
  return false;
}

function _isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
