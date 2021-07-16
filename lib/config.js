/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
import bedrock from 'bedrock';
const {config} = bedrock;
import path from 'path';

const namespace = 'config-yaml';
const cfg = config[namespace] = {app: {}, combined: {}, core: {}};

// The Bedrock events described below are documented here:
// https://github.com/digitalbazaar/bedrock#bedrockevents

// applied by the last handler for `bedrock.configure`
cfg.app.path = path.join('/etc', 'bedrock-config');
cfg.app.filename = 'app.yaml';

// applied by the last handler for `bedrock-cli.parsed`
cfg.core.path = path.join('/etc', 'bedrock-config');
cfg.core.filename = 'core.yaml';

// a combined config may include both an `app` and `core` section
cfg.combined.path = path.join('/etc', 'bedrock-config');
cfg.combined.filename = 'combined.yaml';
