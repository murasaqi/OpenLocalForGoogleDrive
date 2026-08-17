// Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON.

// Requests to this host are tiny; anything bigger is malformed or hostile.
const MAX_MESSAGE_BYTES = 1024 * 1024;

export const encodeMessage = (message) => {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
};

export const readMessage = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    const onData = (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received < 4) return;
      const buffer = Buffer.concat(chunks);
      const length = buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        cleanup();
        resolve(null);
        return;
      }
      if (buffer.length < 4 + length) return;
      cleanup();
      try {
        resolve(JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")));
      } catch (error) {
        reject(new Error(`Malformed native message: ${error.message}`));
      }
    };

    const onEnd = () => {
      cleanup();
      resolve(null);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
