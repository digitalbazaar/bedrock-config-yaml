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

// Errors raised while loading a config must never quote config content, which
// may hold secrets. Messages are opaque by default; this marks the ones built
// by this module, which name only config paths and transformers.
const SAFE_ERROR = Symbol('safeError');

/**
 * An error thrown by a transformer, whose message is safe to include in the
 * startup error because it names only the reason it failed. Transformers that
 * throw any other error get a generic message so that provider errors quoting
 * secret material cannot escape.
 */
export class TransformError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'TransformError';
    this[SAFE_ERROR] = true;
  }
}

/**
 * Creates an error whose message may be surfaced to the caller. Callers are
 * responsible for keeping config values out of the message.
 *
 * @param {string} message - The message.
 * @param {Error} [cause] - The underlying error, for debug logging only.
 *
 * @returns {Error} - The error.
 */
export function safeError(message, cause) {
  const error = cause === undefined ?
    new Error(message) : new Error(message, {cause});
  error[SAFE_ERROR] = true;
  return error;
}

/**
 * Returns an error's message if it is safe to surface, otherwise a fallback.
 *
 * @param {Error} error - The error.
 * @param {string} fallback - The message to use for unsafe errors.
 *
 * @returns {string} - The message.
 */
export function safeMessage(error, fallback) {
  return error?.[SAFE_ERROR] ? error.message : fallback;
}
