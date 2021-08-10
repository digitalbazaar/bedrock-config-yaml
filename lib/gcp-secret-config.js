/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
import jsYaml from 'js-yaml';
import {SecretManagerServiceClient} from '@google-cloud/secret-manager';
const client = new SecretManagerServiceClient();

async function getConfig({configType}) {
  if(!process.env.BEDROCK_CONFIG_YAML_SECRET) {
    return;
  }

  // example: projects/my-project/secrets/my-secret
  const name = `${process.env.BEDROCK_CONFIG_YAML_SECRET}/versions/latest`;
  const [version] = await client.getSecretVersion({name});
  // version example: projects/my-project/secrets/my-secret/versions/1
  const [accessResponse] = await client.accessSecretVersion({
    name: version.name
  });
  const responsePayload = accessResponse.payload.data.toString('utf8');

  const configYaml = jsYaml.safeLoad(responsePayload);
  if(!(configYaml && configYaml[configType])) {
    return;
  }

  return configYaml[configType];
}

export default {getConfig};
