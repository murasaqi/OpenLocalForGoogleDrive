import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { encodeMessage, readMessage } from "../host/lib/framing.mjs";

test("decodes a whole frame written at once", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  stream.write(encodeMessage({ hello: "世界", n: 42 }));
  assert.deepEqual(await promise, { hello: "世界", n: 42 });
});

test("decodes a frame written byte by byte", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  const frame = encodeMessage({ split: true });
  for (const byte of frame) stream.write(Buffer.from([byte]));
  assert.deepEqual(await promise, { split: true });
});

test("decodes when the header itself is split across chunks", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  const frame = encodeMessage({ a: 1 });
  stream.write(frame.subarray(0, 2));
  stream.write(frame.subarray(2, 5));
  stream.write(frame.subarray(5));
  assert.deepEqual(await promise, { a: 1 });
});

test("resolves null when the stream ends mid-frame", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  const frame = encodeMessage({ a: 1 });
  stream.write(frame.subarray(0, frame.length - 2));
  stream.end();
  assert.equal(await promise, null);
});

test("resolves null when the stream ends with no data", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  stream.end();
  assert.equal(await promise, null);
});

test("resolves null for an oversized length header", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(0xffffffff, 0);
  stream.write(header);
  assert.equal(await promise, null);
});

test("rejects on malformed JSON payload", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  const payload = Buffer.from("not json", "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  stream.write(Buffer.concat([header, payload]));
  await assert.rejects(promise, /Malformed native message/);
});

test("ignores trailing bytes after a complete frame", async () => {
  const stream = new PassThrough();
  const promise = readMessage(stream);
  stream.write(Buffer.concat([encodeMessage({ first: true }), Buffer.from("garbage")]));
  assert.deepEqual(await promise, { first: true });
});

test("encodeMessage produces a little-endian length prefix", () => {
  const frame = encodeMessage({});
  assert.equal(frame.readUInt32LE(0), 2);
  assert.equal(frame.subarray(4).toString("utf8"), "{}");
});
