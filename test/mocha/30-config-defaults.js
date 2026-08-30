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

describe('config defaults', () => {
  it('preserves configuration that was set before module initialization',
    async () => {
      const originalConfig = config['config-yaml'];
      const originalClient = config['aws-kms'].clients['config-yaml'];
      const customConfig = {
        app: {path: '/custom/config'},
        sources: {aws: {enabled: true}},
        transformers: {allow: ['env']}
      };
      const customClient = {region: 'eu-west-1'};

      config['config-yaml'] = customConfig;
      config['aws-kms'].clients['config-yaml'] = customClient;
      try {
        const url = new URL('../../lib/config.js', import.meta.url);
        url.searchParams.set('test', `${Date.now()}`);
        await import(url.href);

        config['config-yaml'].should.equal(customConfig);
        config['config-yaml'].app.should.deep.equal({
          path: '/custom/config', filename: 'app.yaml'
        });
        config['config-yaml'].sources.aws.should.deep.equal({
          enabled: true,
          environment: null,
          configLocationTag: 'BedrockConfigSecretName'
        });
        config['config-yaml'].transformers.allow.should.deep.equal(['env']);
        config['aws-kms'].clients['config-yaml'].should.equal(customClient);
      } finally {
        config['config-yaml'] = originalConfig;
        config['aws-kms'].clients['config-yaml'] = originalClient;
      }
    });
});
