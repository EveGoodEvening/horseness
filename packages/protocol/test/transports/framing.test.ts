import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import test from "node:test";
import {JsonRpcFramedReader,JsonRpcFramedWriter} from "../../src/index.js";

async function collect(input:PassThrough,maxFrameBytes=1024):Promise<unknown[]>{
 const values:unknown[]=[];
 for await(const value of new JsonRpcFramedReader(input,{maxFrameBytes}))values.push(value);
 return values;
}

test("newline framing buffers partial frames and round trips",async()=>{
 const stream=new PassThrough(),reading=collect(stream);
 stream.write('{"jsonrpc":"2.0","id":1');stream.write(',"result":{}}\n');stream.end();
 assert.deepEqual(await reading,[{jsonrpc:"2.0",id:1,result:{}}]);
 const output=new PassThrough(),chunks:Buffer[]=[];output.on("data",(chunk:Buffer)=>chunks.push(chunk));
 await new JsonRpcFramedWriter(output).write({ok:true});
 assert.equal(Buffer.concat(chunks).toString("utf8"),'{"ok":true}\n');
});

test("framing rejects malformed, incomplete, and oversized input",async()=>{
 const malformed=new PassThrough();malformed.end("{bad}\n");await assert.rejects(collect(malformed),/Malformed/);
 const incomplete=new PassThrough();incomplete.end('{"id":1}');await assert.rejects(collect(incomplete),/Incomplete/);
 const oversized=new PassThrough();oversized.end('12345\n');await assert.rejects(collect(oversized,4),/exceeds/);
});
