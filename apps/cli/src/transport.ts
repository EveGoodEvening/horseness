import { createConnection, type Socket } from "node:net";
import { JsonRpcFramedReader, JsonRpcFramedWriter, type JsonRpcRequestV1, type JsonRpcResponseV1 } from "@horseness/protocol";
import type { AuthorizedProtocolTransportV1, OpaqueCredentialReferenceV1 } from "@horseness/sdk";

export class CliTransportError extends Error {
  constructor(
    readonly code: "TRANSPORT_ENDPOINT_INVALID" | "TRANSPORT_CONNECTION_FAILED" | "TRANSPORT_PROTOCOL_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CliTransportError";
  }
}

function grantReference(credential: OpaqueCredentialReferenceV1): string {
  if (credential.kind !== "host-reference" || !credential.reference.startsWith("grant:")) {
    throw new CliTransportError("TRANSPORT_PROTOCOL_INVALID", "local daemon transport requires an opaque host grant reference");
  }
  return credential.reference;
}

async function connectedSocket(endpointPath: string): Promise<Socket> {
  if (endpointPath.length === 0 || endpointPath.includes("\0")) {
    throw new CliTransportError("TRANSPORT_ENDPOINT_INVALID", "daemon endpoint path is invalid");
  }

  return await new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(endpointPath);
    function fail(error: Error): void {
      socket.destroy();
      reject(new CliTransportError("TRANSPORT_CONNECTION_FAILED", error.message));
    }
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.off("error", fail);
      resolve(socket);
    });
  });
}

export class AuthorizedLocalTransportV1 implements AuthorizedProtocolTransportV1 {
  constructor(readonly endpointPath: string, readonly maxFrameBytes = 1024 * 1024) {}

  async request(request: JsonRpcRequestV1, credential: OpaqueCredentialReferenceV1): Promise<JsonRpcResponseV1> {
    const socket = await connectedSocket(this.endpointPath);
    socket.on("error", () => socket.destroy());
    const writer = new JsonRpcFramedWriter(socket, { maxFrameBytes: this.maxFrameBytes });
    const frames = new JsonRpcFramedReader(socket, { maxFrameBytes: this.maxFrameBytes })[Symbol.asyncIterator]();
    try {
      await writer.write({ schemaVersion: "1", grantReference: grantReference(credential) });
      await writer.write(request);
      const response = await frames.next();
      if (response.done) {
        throw new CliTransportError("TRANSPORT_PROTOCOL_INVALID", "daemon closed the connection during grant authentication");
      }
      if (typeof response.value !== "object" || response.value === null || Array.isArray(response.value)) {
        throw new CliTransportError("TRANSPORT_PROTOCOL_INVALID", "daemon returned an invalid JSON-RPC response");
      }
      return response.value as JsonRpcResponseV1;
    } catch (error) {
      if (error instanceof CliTransportError) throw error;
      throw new CliTransportError("TRANSPORT_PROTOCOL_INVALID", error instanceof Error ? error.message : "local transport failed");
    } finally {
      socket.end();
      socket.destroy();
    }
  }
}
