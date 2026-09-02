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
import {config} from '@bedrock/core';
import {
  _isRetryable, getAwsSource
} from '@bedrock/config-yaml/lib/aws.js';
import {_createSharedLoader} from '@bedrock/config-yaml';

describe('AWS config source', () => {
  const source = config['config-yaml'].sources.aws;
  let original;

  beforeEach(() => {
    original = {...source};
  });

  afterEach(() => {
    Object.assign(source, original);
  });

  it('is disabled by default', () => {
    should.equal(getAwsSource(), null);
  });

  it('returns a valid enabled source without performing discovery', () => {
    source.enabled = true;
    source.environment = 'nitro';

    getAwsSource().should.equal(source);
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

  it('shares one in-flight AWS configuration load', async () => {
    let calls = 0;
    let finish;
    const read = _createSharedLoader({
      load: () => {
        calls += 1;
        return new Promise(resolve => {
          finish = resolve;
        });
      }
    });

    const first = read();
    const second = read();
    first.should.equal(second);
    calls.should.equal(1);

    finish('config');
    (await first).should.equal('config');
    (await second).should.equal('config');
  });
});
