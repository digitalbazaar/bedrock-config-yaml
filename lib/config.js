/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import bedrock from 'bedrock';
const {config} = bedrock;
import path from 'path';

const namespace = 'config-yaml';
const cfg = config[namespace] = {};

cfg.path = path.join('etc', 'bedrock-config');
cfg.filename = 'config.yaml';
