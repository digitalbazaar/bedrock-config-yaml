/*!
 * Copyright 2020 - 2024 Digital Bazaar, Inc.
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
import {config, events} from '@bedrock/core';
import {_applyConfigFromEnv} from '@bedrock/config-yaml';
import {expect} from 'chai';

describe('bedrock-config-yaml', () => {
  it('app yaml configuration should be merged into bedrock config', () => {
    const testBedrockModuleConfig = {
      bar: 'fromBedrockConfig',
      combinedAppValue: 'hPtQMAHvzECxDRJd',
      foo: 'fromYaml',
      overwriteMe: 'fromYaml',
    };

    config['test-bedrock-module'].should.eql(testBedrockModuleConfig);
  });
  it('core yaml configuration should be merged into bedrock config', () => {
    should.exist(config.loggers.console.someLoggerConfig);
    config.loggers.console.someLoggerConfig.should.be.a('string');
    config.loggers.console.someLoggerConfig.should.equal('foo');
    should.exist(config.loggers.console.someLoggerCombinedConfig);
    config.loggers.console.someLoggerCombinedConfig.should.be.a('string');
    config.loggers.console.someLoggerCombinedConfig
      .should.equal('FDRqpNJLVkgfVxPe');
  });
  it('configuration can be loaded via environment variable', async () => {
    process.env.BEDROCK_CONFIG = 'YXBwOgogIHRlc3QtYmVkcm9jay1lbnYteWFtbDoKI' +
      'CAgIHRlc3RFbnZWYWx1ZTogMTIzMTIzMTIzMTIzCmNvcmU6CiAgdGVzdC1jb3JlLWVud' +
      'jogOTg3NTUzIA==';

    should.not.exist(config['test-bedrock-env-yaml']);
    should.not.exist(config['test-core-env']);

    _applyConfigFromEnv({configType: 'core'});

    should.not.exist(config['test-bedrock-env-yaml']);
    config['test-core-env'].should.eql(987553);

    _applyConfigFromEnv({configType: 'app'});

    config['test-core-env'].should.eql(987553);
    config['test-bedrock-env-yaml'].should.eql({
      testEnvValue: 123123123123
    });
  });
  it('does not expose data when a load from env error throws', async () => {
    // Include a bad config with duplicate key
    const yaml = `
    app:
      sensitive: 1337
      sensitive: hello-world
    core:
      test-core-env: 987553
    `;

    const encodedConfig = Buffer.from(yaml).toString('base64');
    process.env.BEDROCK_CONFIG = encodedConfig;

    let output = '';
    await events.emit('bedrock.configure').catch(e => {
      output = e.message;
    }).finally(() => {
      delete process.env.BEDROCK_CONFIG;
    });

    expect(output).to.not.include('1337');
  });
  it('does not expose data when a load from config error throws', async () => {
    const origConfig = config['config-yaml'].app;
    let output = '';

    try {
      origConfig.filename = 'invalid.yaml';
      await events.emit('bedrock.configure').catch(e => {
        output = e.message;
      });
    } finally {
      config['config-yaml'].app = origConfig;
    }

    expect(output).to.not.include('1337');
  });
});
