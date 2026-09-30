import test from "node:test"; import assert from "node:assert/strict"; import {newToken,hashToken} from "../src/token.js";
test("tokens são aleatórios e hash não expõe token",()=>{const a=newToken(),b=newToken();assert.notEqual(a,b);assert.notEqual(hashToken(a),a);assert.equal(hashToken(a),hashToken(a));});
