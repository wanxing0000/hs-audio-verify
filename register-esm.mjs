import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./esm-js-loader.mjs', pathToFileURL('./'));
