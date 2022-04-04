/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {fileURLToPath} from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config.mocha.tests.push(path.join(__dirname, 'mocha'));
