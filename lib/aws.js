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
import {getClient, getDefaultRegion} from '@bedrock/aws-kms';
import {
  GetSecretValueCommand, SecretsManagerClient
} from '@aws-sdk/client-secrets-manager';
import {decryptEnvelope, parseEnvelope} from './envelope.js';
import {httpClient} from '@digitalbazaar/http-client';
import {logger} from './logger.js';

const {config, util: {BedrockError}} = bedrock;

const IMDS_BASE_URL = 'http://169.254.169.254/latest';
const IMDS_TIMEOUT_MS = 5000;
const MAX_WAIT_MS = 300000;
const RETRYABLE_ERROR_NAMES = {
  kms_decrypt: new Set([
    'NetworkError', 'NotAllowedError', 'TimeoutError'
  ]),
  secret_fetch: new Set(['NotFoundError', 'TimeoutError'])
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
  const secretId = await _getSecretId({
    secretIdTag: source.secretIdTag
  });
  const region = await getDefaultRegion();
  const kmsClient = getClient({name: 'config-yaml'});
  const secretsClient = new SecretsManagerClient({region});
  const startedAt = Date.now();
  const deadline = startedAt + MAX_WAIT_MS;
  let delay = 5000;
  let attempt = 0;

  logger.info('AWS bedrock config load started', {
    secretId,
    region,
    maxWaitSeconds: MAX_WAIT_MS / 1000
  });

  try {
    while(true) {
      attempt += 1;
      let stage = 'secret_fetch';
      try {
        const envelope = await _fetchEnvelope({
          client: secretsClient, secretId, region
        });

        stage = 'kms_decrypt';
        const {plaintext: dataKey} = await kmsClient.decryptWithAttestation({
          ciphertext: envelope.encryptedDataKey
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
          secretId,
          envelopeVersion: envelope.version,
          kmsKeyId: envelope.kmsKeyId,
          plaintextSha256: envelope.plaintextSha256
        });
        return new TextDecoder().decode(plaintext);
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
    secretsClient.destroy();
  }
}

async function _getSecretId({secretIdTag}) {
  let token;
  try {
    const tokenResponse = await httpClient.put(
      `${IMDS_BASE_URL}/api/token`, {
        headers: {
          'X-aws-ec2-metadata-token-ttl-seconds': '60'
        },
        parseBody: false,
        retry: 0,
        timeout: IMDS_TIMEOUT_MS
      });
    token = (await tokenResponse.text()).trim();
  } catch(cause) {
    throw _metadataError({cause, stage: 'token'});
  }
  if(!token) {
    throw new BedrockError(
      'EC2 instance metadata returned an empty token.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false
      });
  }

  let secretId;
  try {
    const path = 'meta-data/tags/instance/' +
      encodeURIComponent(secretIdTag);
    const response = await httpClient.get(`${IMDS_BASE_URL}/${path}`, {
      headers: {
        'X-aws-ec2-metadata-token': token
      },
      parseBody: false,
      retry: 0,
      timeout: IMDS_TIMEOUT_MS
    });
    secretId = (await response.text()).trim();
  } catch(cause) {
    throw _metadataError({cause, stage: 'instance_tag'});
  }
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

function _metadataError({cause, stage}) {
  const status = cause.status ?? cause.response?.status;
  const notFound = status === 404;
  return new BedrockError(
    'Could not discover the AWS bedrock config SecretId from EC2 instance metadata.',
    notFound ? 'NotFoundError' : 'NetworkError', {
      httpStatusCode: notFound ? 404 : 503,
      public: false,
      metadataStatusCode: status ?? null,
      stage,
      cause
    });
}

async function _fetchEnvelope({client, secretId, region}) {
  let response;
  try {
    response = await client.send(
      new GetSecretValueCommand({SecretId: secretId}));
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

function _isRetryable({stage, error}) {
  return RETRYABLE_ERROR_NAMES[stage]?.has(error.name) ?? false;
}

function _isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
