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
import * as chai from 'chai';
import {_applyConfigFromEnv, registerTransformer} from '@bedrock/config-yaml';
import chaiAsPromised from 'chai-as-promised';
import {config} from '@bedrock/core';

chai.use(chaiAsPromised);

const {expect} = chai;

const testState = config['test-transformers'];
const transformerCfg = config['config-yaml'].transformers;

// loads a config through the `BEDROCK_CONFIG` environment variable, which
// exercises the same parse, resolve, and merge path as a config file
async function applyEnvConfig({yaml, configType = 'app'}) {
  process.env.BEDROCK_CONFIG = Buffer.from(yaml).toString('base64');
  try {
    await _applyConfigFromEnv({configType});
  } finally {
    delete process.env.BEDROCK_CONFIG;
  }
}

describe('config transformers', () => {
  beforeEach(() => {
    testState.calls.length = 0;
  });

  describe('allow list', () => {
    it('is empty by default', async () => {
      testState.defaultAllow.should.eql([]);
    });
    it('rejects a transformer that is not registered', async () => {
      const yaml = `
      app:
        test-unknown-transformer: !test-nope value
      `;

      await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
        'unknown config transformer "!test-nope" at ' +
        '"test-unknown-transformer"');
      should.not.exist(config['test-unknown-transformer']);
    });
    it('rejects a registered transformer that is not allowed', async () => {
      const yaml = `
      app:
        test-disallowed-transformer:
          nested: !test-not-allowed value
      `;

      await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
        'config transformer "!test-not-allowed" at ' +
        '"test-disallowed-transformer.nested" is not allowed');
      should.not.exist(config['test-disallowed-transformer']);
    });
    it('allows every registered transformer when set to `true`', async () => {
      const yaml = `
      app:
        test-allow-true: !test-not-allowed value
      `;

      const original = transformerCfg.allow;
      try {
        transformerCfg.allow = true;
        await applyEnvConfig({yaml});
      } finally {
        transformerCfg.allow = original;
      }

      config['test-allow-true'].should.equal('should-not-happen:value');
    });
  });

  describe('enabling from a deployment config', () => {
    let originalAllow;

    beforeEach(() => {
      originalAllow = transformerCfg.allow;
    });
    afterEach(() => {
      transformerCfg.allow = originalAllow;
    });

    it('enables a transformer used by the same config', async () => {
      const yaml = `
      app:
        config-yaml:
          transformers:
            allow: ['test-not-allowed']
        test-enable-same-config: !test-not-allowed value
      `;

      await applyEnvConfig({yaml});

      config['test-enable-same-config'].should
        .equal('should-not-happen:value');
      // the settings were merged into the config as well
      transformerCfg.allow.should.eql(['test-not-allowed']);
    });
    it('enables a transformer from the `core` config for the `app` config',
      async () => {
        const yaml = `
        core:
          config-yaml:
            transformers:
              allow: ['test-not-allowed']
        app:
          test-enable-cross-pass: !test-not-allowed value
        `;

        await applyEnvConfig({yaml, configType: 'core'});
        await applyEnvConfig({yaml, configType: 'app'});

        config['test-enable-cross-pass'].should
          .equal('should-not-happen:value');
      });
    it('cannot enable a transformer that is not registered', async () => {
      const yaml = `
      app:
        config-yaml:
          transformers:
            allow: ['test-never-registered']
        test-enable-unregistered: !test-never-registered value
      `;

      await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
        'unknown config transformer "!test-never-registered" at ' +
        '"test-enable-unregistered"');
      should.not.exist(config['test-enable-unregistered']);
    });
    it('rejects directives inside the transformer config', async () => {
      const yaml = `
      app:
        config-yaml:
          transformers:
            allow: !test-echo something
      `;

      await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
        '"config-yaml.transformers" may not contain config transformers');
    });
  });

  describe('resolution', () => {
    it('passes the node kind and config path to the transformer', async () => {
      const yaml = `
      app:
        test-kinds:
          scalar: !test-echo one
          sequence: !test-echo [a, b]
          mapping: !test-echo {a: 1}
      `;

      await applyEnvConfig({yaml});

      config['test-kinds'].should.eql({
        scalar: 'echo:one',
        sequence: ['a', 'b'],
        mapping: {a: 1}
      });
      testState.calls.map(({kind, path}) => `${kind} ${path}`).sort()
        .should.eql([
          'mapping test-kinds.mapping',
          'scalar test-kinds.scalar',
          'sequence test-kinds.sequence'
        ]);
      testState.calls.every(({configType}) => configType === 'app')
        .should.equal(true);
    });
    it('rejects a value of a kind the transformer does not accept',
      async () => {
        const yaml = `
        app:
          test-wrong-kind: !test-throws {a: 1}
        `;

        // `test-throws` is scalar-only; the kind is checked before it is called
        await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
          'config transformer "!test-throws" at "test-wrong-kind" does not ' +
          'accept a mapping value');
      });
    it('resolves nested directives innermost first', async () => {
      const yaml = `
      app:
        test-nested: !test-echo {value: !test-echo inner}
      `;

      await applyEnvConfig({yaml});

      config['test-nested'].should.eql({value: 'echo:inner'});
    });
    it('resolves identical directives once', async () => {
      const yaml = `
      app:
        test-dedupe:
          first: !test-echo same
          second: !test-echo same
          other: !test-echo different
      `;

      await applyEnvConfig({yaml});

      config['test-dedupe'].should.eql({
        first: 'echo:same',
        second: 'echo:same',
        other: 'echo:different'
      });
      testState.calls.should.have.length(2);
    });
    it('resolves a directive reached through an alias once', async () => {
      const yaml = `
      app:
        test-alias:
          anchored: &shared !test-echo aliased
          alias: *shared
      `;

      const original = transformerCfg.cache;
      try {
        // with the value cache off, only alias identity prevents a second call
        transformerCfg.cache = false;
        await applyEnvConfig({yaml});
      } finally {
        transformerCfg.cache = original;
      }

      config['test-alias'].should.eql({
        anchored: 'echo:aliased',
        alias: 'echo:aliased'
      });
      testState.calls.should.have.length(1);
    });
    it('resolves identical directives twice when caching is off', async () => {
      const yaml = `
      app:
        test-no-cache:
          first: !test-echo same
          second: !test-echo same
      `;

      const original = transformerCfg.cache;
      try {
        transformerCfg.cache = false;
        await applyEnvConfig({yaml});
      } finally {
        transformerCfg.cache = original;
      }

      testState.calls.should.have.length(2);
    });
    it('leaves a config without directives untouched', async () => {
      const yaml = `
      app:
        test-no-directives:
          nested: {a: 1}
          list: [1, 2]
      `;

      await applyEnvConfig({yaml});

      config['test-no-directives'].should.eql({
        nested: {a: 1},
        list: [1, 2]
      });
      testState.calls.should.have.length(0);
    });
  });

  describe('errors', () => {
    it('does not expose the message of a transformer error', async () => {
      const yaml = `
      app:
        test-error: !test-throws value
      `;

      let output = '';
      await applyEnvConfig({yaml}).catch(e => {
        output = e.message;
      });

      output.should.include(
        'config transformer "!test-throws" at "test-error" failed');
      output.should.not.include('unsafe-1337');
    });
    it('exposes the message of a `TransformError`', async () => {
      const yaml = `
      app:
        test-safe-error: !test-throws-safe value
      `;

      await expect(applyEnvConfig({yaml})).to.be.rejectedWith(
        Error, 'safe-detail');
    });
    it('does not expose config values when a transformer fails', async () => {
      const yaml = `
      app:
        test-error-values:
          sensitive: !test-throws hello-world
      `;

      let output = '';
      await applyEnvConfig({yaml}).catch(e => {
        output = e.message;
      });

      output.should.not.include('hello-world');
      output.should.not.include('unsafe-1337');
    });
    it('fails when transformers exceed the timeout', async () => {
      const yaml = `
      app:
        test-timeout: !test-hangs value
      `;

      const original = transformerCfg.timeout;
      try {
        transformerCfg.timeout = 100;
        await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
          'config transformers did not complete within 100ms');
      } finally {
        transformerCfg.timeout = original;
      }
      should.not.exist(config['test-timeout']);
    });
  });

  describe('registerTransformer', () => {
    it('throws once the "app" config has been applied', () => {
      expect(() => registerTransformer({
        name: 'test-too-late',
        transform: () => 'value'
      })).to.throw(Error, 'has already been applied');
    });
    it('throws on an invalid name', () => {
      expect(() => registerTransformer({
        name: '!nope',
        transform: () => 'value'
      })).to.throw(TypeError, 'must be a string beginning with a letter');
    });
    it('throws on an invalid kind', () => {
      expect(() => registerTransformer({
        name: 'test-invalid-kind',
        transform: () => 'value',
        kinds: ['scalar', 'nope']
      })).to.throw(TypeError, 'must be a non-empty array');
    });
    it('throws when "transform" is not a function', () => {
      expect(() => registerTransformer({
        name: 'test-no-transform'
      })).to.throw(TypeError, '"transform" must be a function');
    });
  });
});

describe('env transformer', () => {
  it('applies from a config file at startup', async () => {
    config['test-transformer-app'].should.eql({
      echoed: 'echo:hello',
      fromEnv: 'fromEnvVar',
      port: 18443,
      defaulted: 'fallback'
    });
  });
  it('applies to the "core" config at startup', async () => {
    config['test-transformer-core'].echoed.should.equal('echo:core-value');
  });
  it('coerces types', async () => {
    process.env.TEST_ENV_NUMBER = '42';
    process.env.TEST_ENV_BOOLEAN = 'YES';
    process.env.TEST_ENV_JSON = '{"a": [1, 2]}';

    const yaml = `
    app:
      test-env-types:
        number: !env {name: TEST_ENV_NUMBER, type: number}
        boolean: !env {name: TEST_ENV_BOOLEAN, type: boolean}
        json: !env {name: TEST_ENV_JSON, type: json}
        string: !env TEST_ENV_NUMBER
    `;

    try {
      await applyEnvConfig({yaml});
    } finally {
      delete process.env.TEST_ENV_NUMBER;
      delete process.env.TEST_ENV_BOOLEAN;
      delete process.env.TEST_ENV_JSON;
    }

    config['test-env-types'].should.eql({
      number: 42,
      boolean: true,
      json: {a: [1, 2]},
      string: '42'
    });
  });
  it('fails when a required variable is not set', async () => {
    const yaml = `
    app:
      test-env-missing: !env TEST_ENV_DOES_NOT_EXIST
    `;

    await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
      'requires the "TEST_ENV_DOES_NOT_EXIST" environment variable, which ' +
      'is not set');
  });
  it('fails when a value cannot be coerced', async () => {
    process.env.TEST_ENV_NOT_A_NUMBER = 'abc';

    const yaml = `
    app:
      test-env-bad-number: !env {name: TEST_ENV_NOT_A_NUMBER, type: number}
    `;

    try {
      await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
        'expected the "TEST_ENV_NOT_A_NUMBER" environment variable to be a ' +
        'number');
    } finally {
      delete process.env.TEST_ENV_NOT_A_NUMBER;
    }
  });
  it('does not expose the value of an unparsable JSON variable', async () => {
    process.env.TEST_ENV_BAD_JSON = '{sensitive: 1337}';

    const yaml = `
    app:
      test-env-bad-json: !env {name: TEST_ENV_BAD_JSON, type: json}
    `;

    let output = '';
    try {
      await applyEnvConfig({yaml}).catch(e => {
        output = e.message;
      });
    } finally {
      delete process.env.TEST_ENV_BAD_JSON;
    }

    output.should.include('to be valid JSON');
    output.should.not.include('1337');
  });
  it('fails on an unknown type', async () => {
    const yaml = `
    app:
      test-env-bad-type: !env {name: TEST_CONFIG_YAML_APP, type: nope}
    `;

    await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
      'has an unknown "type" option');
  });
  it('fails when no variable name is given', async () => {
    const yaml = `
    app:
      test-env-no-name: !env {type: number}
    `;

    await expect(applyEnvConfig({yaml})).to.be.rejectedWith(Error,
      'requires an environment variable name');
  });
  it('restricts which variables may be read', async () => {
    const yaml = `
    app:
      test-env-restricted:
        allowed: !env TEST_CONFIG_YAML_APP
    `;
    const deniedYaml = `
    app:
      test-env-denied: !env TEST_CONFIG_YAML_PORT
    `;

    const original = transformerCfg.env.allow;
    try {
      transformerCfg.env.allow = [/^TEST_CONFIG_YAML_APP$/];

      await applyEnvConfig({yaml});
      config['test-env-restricted'].allowed.should.equal('fromEnvVar');

      await expect(applyEnvConfig({yaml: deniedYaml})).to.be.rejectedWith(Error,
        'may not read the "TEST_CONFIG_YAML_PORT" environment variable');
    } finally {
      transformerCfg.env.allow = original;
    }
    should.not.exist(config['test-env-denied']);
  });
});
