/*!
 * Copyright 2026 Digital Bazaar, Inc.
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
import {
  _isRetryable, getAwsSource, readConfigFromAws
} from '@bedrock/config-yaml/lib/aws.js';
import {config, events} from '@bedrock/core';
import {createCipheriv, createHash} from 'node:crypto';
import {getClient} from '@bedrock/aws-kms';
import {httpClient} from '@digitalbazaar/http-client';
import {SecretsManagerClient} from '@aws-sdk/client-secrets-manager';
import sinon from 'sinon';

describe('AWS config source', () => {
  const source = config['config-yaml'].sources.aws;
  const environmentVariable = 'AWS_REGION';
  let original;
  let originalEnvironment;

  beforeEach(() => {
    original = {...source};
    originalEnvironment = process.env[environmentVariable];
    process.env[environmentVariable] = 'us-east-1';
  });

  afterEach(() => {
    sinon.restore();
    Object.assign(source, original);
    if(originalEnvironment === undefined) {
      delete process.env[environmentVariable];
    } else {
      process.env[environmentVariable] = originalEnvironment;
    }
  });

  it('is disabled by default', () => {
    should.equal(getAwsSource(), null);
  });

  it('returns a valid enabled source without performing discovery', () => {
    source.enabled = true;
    source.environment = 'nitro';

    getAwsSource().should.equal(source);
  });

  it('rejects an invalid maxWaitMs before discovery', () => {
    source.enabled = true;
    source.environment = 'nitro';
    source.maxWaitMs = -1;

    (() => getAwsSource()).should.throw(
      'The AWS bedrock config maxWaitMs is invalid.');
  });

  it('rejects an unsupported environment before discovery', () => {
    source.enabled = true;
    source.environment = 'standard';

    (() => getAwsSource()).should.throw(
      'The configured AWS bedrock config environment is not implemented.');
  });

  it('classifies startup dependency failures for bounded retries', () => {
    const cases = [
      ['region_discovery', 'CredentialsProviderError'],
      ['region_discovery', 'NetworkError'],
      ['secret_id_discovery', 'NotFoundError'],
      ['secret_fetch', 'NotAllowedError'],
      ['secret_fetch', 'NotFoundError'],
      ['kms_decrypt', 'CredentialsProviderError'],
      ['kms_decrypt', 'NotAllowedError']
    ];
    for(const [stage, name] of cases) {
      _isRetryable({stage, error: {name}}).should.equal(true);
    }
  });

  it('uses AWS retry metadata only at AWS client stages', () => {
    const error = {name: 'ServiceError', $retryable: {throttling: true}};
    _isRetryable({stage: 'secret_fetch', error}).should.equal(true);
    _isRetryable({stage: 'kms_decrypt', error}).should.equal(true);
    _isRetryable({stage: 'envelope_decrypt', error}).should.equal(false);
  });

  it('fails fast for permanent config data errors', () => {
    _isRetryable({
      stage: 'secret_fetch', error: {name: 'DataError'}
    }).should.equal(false);
  });

  it('rejects non-finite startup budgets before discovery', () => {
    source.enabled = true;
    source.environment = 'nitro';
    for(const value of [NaN, Infinity, -Infinity]) {
      source.maxWaitMs = value;
      (() => getAwsSource()).should.throw(
        'The AWS bedrock config maxWaitMs is invalid.');
    }
  });

  it('times out an AWS request that never settles', async () => {
    source.enabled = true;
    source.environment = 'nitro';
    source.maxWaitMs = 20;
    sinon.stub(httpClient, 'put').resolves({text: async () => 'token'});
    sinon.stub(httpClient, 'get').resolves({text: async () => 'secret'});
    sinon.stub(SecretsManagerClient.prototype, 'send').returns(
      new Promise(() => {}));

    await readConfigFromAws().should.be.rejectedWith(
      'Bedrock config did not become ready before the deadline.');
  });

  it('ends retries when the startup budget expires', async () => {
    source.enabled = true;
    source.environment = 'nitro';
    source.maxWaitMs = 10000;
    const clock = sinon.useFakeTimers();
    sinon.stub(httpClient, 'put').resolves({text: async () => 'token'});
    sinon.stub(httpClient, 'get').resolves({text: async () => 'secret'});
    const send = sinon.stub(SecretsManagerClient.prototype, 'send').rejects(
      Object.assign(new Error('not ready'), {
        name: 'ResourceNotFoundException'
      }));
    const load = readConfigFromAws().catch(error => error);

    await clock.tickAsync(10001);
    const error = await load;
    error.name.should.equal('TimeoutError');
    error.details.maxWaitMs.should.equal(10000);
    error.details.dependencyStage.should.equal('secret_fetch');
    sinon.assert.calledTwice(send);
  });

  it('does not retry when maxWaitMs is zero', async () => {
    source.enabled = true;
    source.environment = 'nitro';
    source.maxWaitMs = 0;
    sinon.stub(httpClient, 'put').resolves({text: async () => 'token'});
    sinon.stub(httpClient, 'get').resolves({text: async () => 'secret'});
    const send = sinon.stub(SecretsManagerClient.prototype, 'send').rejects(
      Object.assign(new Error('not ready'), {
        name: 'ResourceNotFoundException'
      }));

    await readConfigFromAws().should.be.rejectedWith(
      'Bedrock config did not become ready before the deadline.');
    sinon.assert.calledOnce(send);
  });

  it('uses one fetched config for core and app startup events', async () => {
    source.enabled = true;
    source.environment = 'nitro';
    sinon.stub(httpClient, 'put').resolves({text: async () => 'token'});
    sinon.stub(httpClient, 'get').resolves({text: async () => 'secret'});
    const key = Buffer.alloc(32, 1);
    const iv = Buffer.alloc(12, 2);
    const plaintext = 'core:\n  aws-core-test: true\n' +
      'app:\n  aws-app-test: true\n';
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext), cipher.final()
    ]);
    const send = sinon.stub(SecretsManagerClient.prototype, 'send').resolves({
      SecretString: JSON.stringify({
        version: 1, format: 'yaml', kmsKeyId: 'test',
        encryptedDataKey: Buffer.from('ciphertext').toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        plaintextSha256: createHash('sha256').update(plaintext).digest('hex')
      })
    });
    config['aws-kms'].clients['config-yaml'] ??= {};
    const decrypt = sinon.stub(
      getClient({name: 'config-yaml'}), 'decryptWithAttestation').resolves({
      plaintext: key
    });

    await events.emit('bedrock-cli.parsed');
    await events.emit('bedrock.configure');

    config['aws-core-test'].should.equal(true);
    config['aws-app-test'].should.equal(true);
    sinon.assert.calledOnce(send);
    sinon.assert.calledOnce(decrypt);
    delete config['aws-core-test'];
    delete config['aws-app-test'];
  });
});
