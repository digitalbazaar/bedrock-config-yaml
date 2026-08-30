/*!
 * Copyright 2020 - 2026 Digital Bazaar, Inc.
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
import {getAwsSource} from '@bedrock/config-yaml/lib/aws.js';

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
});
