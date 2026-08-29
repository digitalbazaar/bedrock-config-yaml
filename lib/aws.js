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
import {
  classifyKmsDecryptError, getClient, getDefaultRegion
} from '@bedrock/aws-kms';
import {createDecipheriv, createHash} from 'node:crypto';
import {
  GetSecretValueCommand, SecretsManagerClient
} from '@aws-sdk/client-secrets-manager';
import {Buffer} from 'node:buffer';
import {httpClient} from '@digitalbazaar/http-client';
import {logger} from './logger.js';

const {config, util: {BedrockError}} = bedrock;

const IMDS_BASE_URL = 'http://169.254.169.254/latest';
const IMDS_TIMEOUT_MS = 5000;
const MAX_WAIT_MS = 300000;
const RETRYABLE_ERRORS = new Set([
  'kms_access_denied', 'kms_socket_error', 'secret_not_ready'
]);

let awsSourcePromise;
let configPromise;

export async function getAwsSource() {
  const source = config['config-yaml'].sources?.aws;
  if(source === undefined) {
    return null;
  }
  if(!_isObject(source)) {
    throw new BedrockError(
      'The AWS bedrock config source is invalid.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_SOURCE_INVALID'
      });
  }
  if(source.enabled !== true) {
    return null;
  }
  if(typeof source.configLocationTag !== 'string' ||
    source.configLocationTag.length === 0) {
    throw new BedrockError(
      'The AWS bedrock config location tag is invalid.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_LOCATION_TAG_INVALID'
      });
  }
  if(awsSourcePromise === undefined) {
    awsSourcePromise = _discoverAwsSource({source});
  }
  return awsSourcePromise;
}

async function _discoverAwsSource({source}) {
  const configName = await _getConfigName({
    configLocationTag: source.configLocationTag
  });
  if(configName === null) {
    return null;
  }
  if(source.environment !== 'nitro') {
    throw new BedrockError(
      'The configured AWS bedrock config environment is not implemented.',
      'NotSupportedError', {
        httpStatusCode: 501,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_AWS_ENVIRONMENT_NOT_SUPPORTED',
        environment: source.environment ?? null,
        supportedEnvironments: ['nitro']
      });
  }
  return {configName};
}

export async function readConfigFromAws() {
  configPromise ??= _loadWithRetry();
  try {
    return await configPromise;
  } catch(error) {
    configPromise = undefined;
    throw error;
  }
}

async function _loadWithRetry() {
  const {configName} = await getAwsSource();
  const region = await getDefaultRegion();
  const kmsClient = await getClient({name: 'config-yaml'});
  const secretsClient = new SecretsManagerClient({region});
  const startedAt = Date.now();
  const deadline = startedAt + MAX_WAIT_MS;
  let delay = 5000;
  let attempt = 0;

  logger.info('AWS bedrock config load started', {
    configName,
    region,
    maxWaitSeconds: MAX_WAIT_MS / 1000
  });

  try {
    while(true) {
      attempt += 1;
      let stage = 'secret_fetch';
      try {
        const envelope = await _fetchEnvelope({
          client: secretsClient, configName, region
        });
        const encryptedDataKey = _decodeBase64(envelope.encryptedDataKey);

        stage = 'kms_decrypt';
        const {plaintext: dataKey} = await kmsClient.decryptWithAttestation({
          ciphertext: encryptedDataKey
        });

        stage = 'payload_decrypt';
        let plaintext;
        try {
          plaintext = _decryptPayload({envelope, key: dataKey});
        } finally {
          dataKey.fill(0);
        }

        stage = 'plaintext_hash';
        _verifyHash({plaintext, envelope});
        logger.info('AWS bedrock config loaded', {
          attempt,
          configName,
          envelopeVersion: envelope.version,
          kmsKeyId: envelope.kmsKeyId,
          plaintextSha256: envelope.plaintextSha256
        });
        return plaintext.toString('utf8');
      } catch(error) {
        const errorClass = _classifyStartupError({stage, error});
        const retryable = RETRYABLE_ERRORS.has(errorClass);
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
              code: 'ERR_BEDROCK_CONFIG_STARTUP_TIMEOUT',
              dependencyStage: stage,
              errorClass,
              attempt,
              maxWaitSeconds: MAX_WAIT_MS / 1000,
              cause: error
            });
        }
        const wait = Math.min(delay, remaining);
        logger.warning('AWS bedrock config dependency is not ready', {
          attempt,
          dependencyStage: stage,
          errorClass,
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

async function _getConfigName({configLocationTag}) {
  try {
    const token = await _getImdsToken();
    const path = 'meta-data/tags/instance/' +
      encodeURIComponent(configLocationTag);
    return await _getImdsMetadata({token, path}) || null;
  } catch(error) {
    if(error.name === 'NetworkError' || error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
}

async function _getImdsToken() {
  try {
    const response = await httpClient.put(`${IMDS_BASE_URL}/api/token`, {
      headers: {
        'X-aws-ec2-metadata-token-ttl-seconds': '60'
      },
      parseBody: false,
      retry: 0,
      timeout: IMDS_TIMEOUT_MS
    });
    const token = (await response.text()).trim();
    if(token) {
      return token;
    }
    throw new BedrockError(
      'EC2 instance metadata returned an empty token.',
      'InvalidStateError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_AWS_IMDS_TOKEN_MISSING'
      });
  } catch(error) {
    if(error instanceof BedrockError) {
      throw error;
    }
    throw _metadataError({error, stage: 'token'});
  }
}

async function _getImdsMetadata({token, path}) {
  try {
    const response = await httpClient.get(`${IMDS_BASE_URL}/${path}`, {
      headers: {
        'X-aws-ec2-metadata-token': token
      },
      parseBody: false,
      retry: 0,
      timeout: IMDS_TIMEOUT_MS
    });
    return (await response.text()).trim();
  } catch(error) {
    throw _metadataError({error, stage: path});
  }
}

function _metadataError({error, stage}) {
  const status = error.status ?? error.response?.status;
  const notFound = status === 404;
  return new BedrockError(
    'Could not read EC2 instance metadata.',
    notFound ? 'NotFoundError' : 'NetworkError', {
      httpStatusCode: notFound ? 404 : 503,
      public: false,
      code: notFound ? 'ERR_AWS_IMDS_METADATA_NOT_FOUND' :
        'ERR_AWS_IMDS_REQUEST_FAILED',
      metadataStatusCode: status ?? null,
      stage,
      cause: error
    });
}

async function _fetchEnvelope({client, configName, region}) {
  let response;
  try {
    response = await client.send(
      new GetSecretValueCommand({SecretId: configName}));
  } catch(error) {
    const common = {
      configName,
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
          code: 'ERR_BEDROCK_CONFIG_SECRET_NOT_FOUND',
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
          code: 'ERR_BEDROCK_CONFIG_SECRET_NOT_ALLOWED',
          cause: error
        });
    }
    throw new BedrockError(
      'Could not fetch the bedrock config secret.',
      'NetworkError', {
        ...common,
        httpStatusCode: 503,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_SECRET_FETCH_FAILED',
        cause: error
      });
  }

  if(typeof response.SecretString !== 'string') {
    throw new BedrockError(
      'The bedrock config secret did not contain SecretString.',
      'DataError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_SECRET_STRING_MISSING',
        configName,
        region,
        secretVersionId: response.VersionId ?? null
      });
  }

  let envelope;
  try {
    envelope = JSON.parse(response.SecretString);
  } catch(error) {
    throw new BedrockError(
      'The bedrock config SecretString is not valid JSON.',
      'SyntaxError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_ENVELOPE_JSON_INVALID',
        configName,
        region,
        cause: error
      });
  }
  _validateEnvelope({envelope});
  return envelope;
}

function _validateEnvelope({envelope}) {
  if(!_isObject(envelope) || envelope.version !== 1 ||
    envelope.format !== 'yaml') {
    throw new BedrockError(
      'The bedrock config envelope format is not supported.',
      'NotSupportedError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_ENVELOPE_UNSUPPORTED',
        expectedVersion: 1,
        actualVersion: envelope?.version ?? null,
        expectedFormat: 'yaml',
        actualFormat: envelope?.format ?? null
      });
  }

  for(const name of [
    'kmsKeyId', 'encryptedDataKey', 'iv', 'authTag', 'ciphertext',
    'plaintextSha256'
  ]) {
    if(typeof envelope[name] !== 'string' || envelope[name].length === 0) {
      throw new BedrockError(
        'The bedrock config envelope is incomplete.',
        'DataError', {
          httpStatusCode: 500,
          public: false,
          code: 'ERR_BEDROCK_CONFIG_ENVELOPE_FIELD_MISSING',
          field: name
        });
    }
  }

  for(const [name, expectedBytes] of [
    ['encryptedDataKey', null],
    ['iv', 12],
    ['authTag', 16],
    ['ciphertext', null]
  ]) {
    const value = _decodeBase64(envelope[name]);
    if(!value || (expectedBytes !== null && value.length !== expectedBytes)) {
      throw new BedrockError(
        'A bedrock config envelope field is invalid.',
        'DataError', {
          httpStatusCode: 500,
          public: false,
          code: 'ERR_BEDROCK_CONFIG_ENVELOPE_BINARY_FIELD_INVALID',
          field: name,
          expectedBytes,
          actualBytes: value?.length ?? null
        });
    }
  }

  if(!/^[a-f0-9]{64}$/u.test(envelope.plaintextSha256)) {
    throw new BedrockError(
      'The bedrock config plaintext hash is invalid.',
      'DataError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_PLAINTEXT_HASH_INVALID',
        hashLength: envelope.plaintextSha256.length
      });
  }
}

function _decryptPayload({envelope, key}) {
  if(!Buffer.isBuffer(key) || key.length !== 32) {
    throw new BedrockError(
      'The decrypted bedrock config data key is invalid.',
      'DataError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_DATA_KEY_LENGTH_INVALID',
        expectedBytes: 32,
        actualBytes: Buffer.isBuffer(key) ? key.length : null
      });
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm', key, _decodeBase64(envelope.iv), {
        authTagLength: 16
      });
    decipher.setAuthTag(_decodeBase64(envelope.authTag));
    return Buffer.concat([
      decipher.update(_decodeBase64(envelope.ciphertext)),
      decipher.final()
    ]);
  } catch(error) {
    throw new BedrockError(
      'Could not decrypt the bedrock config payload.',
      'OperationError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_PAYLOAD_DECRYPT_FAILED',
        cause: error
      });
  }
}

function _verifyHash({plaintext, envelope}) {
  const actual = createHash('sha256').update(plaintext).digest('hex');
  if(actual !== envelope.plaintextSha256) {
    throw new BedrockError(
      'The decrypted bedrock config failed its integrity check.',
      'DataError', {
        httpStatusCode: 500,
        public: false,
        code: 'ERR_BEDROCK_CONFIG_HASH_MISMATCH',
        expectedSha256: envelope.plaintextSha256,
        actualSha256: actual
      });
  }
}

function _decodeBase64(value) {
  if(typeof value !== 'string' || value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
      .test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 0 ? null : decoded;
}

function _classifyStartupError({stage, error}) {
  if(stage === 'kms_decrypt') {
    return classifyKmsDecryptError(error);
  }
  if(stage === 'secret_fetch') {
    const code = error.details?.code;
    if(code === 'ERR_BEDROCK_CONFIG_SECRET_NOT_FOUND' ||
      code === 'ERR_BEDROCK_CONFIG_SECRET_FETCH_FAILED' ||
      code === 'ERR_BEDROCK_CONFIG_SECRET_STRING_MISSING') {
      return 'secret_not_ready';
    }
    return 'secret_fetch_error';
  }
  return `${stage}_error`;
}

function _isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
