import {once} from "node:events";
import type {Readable,Writable} from "node:stream";

export interface JsonRpcFramingOptionsV1 {
 readonly maxFrameBytes?:number;
}

const DEFAULT_MAX_FRAME_BYTES=1024*1024;

function frameLimit(options:JsonRpcFramingOptionsV1):number{
 const value=options.maxFrameBytes??DEFAULT_MAX_FRAME_BYTES;
 if(!Number.isSafeInteger(value)||value<1)throw new RangeError("maxFrameBytes must be a positive safe integer");
 return value;
}

/** Reads UTF-8 newline-delimited JSON values without ever buffering an unbounded frame. */
export class JsonRpcFramedReader implements AsyncIterable<unknown>{
 readonly #input:Readable;
 readonly #maxFrameBytes:number;
 constructor(input:Readable,options:JsonRpcFramingOptionsV1={}){this.#input=input;this.#maxFrameBytes=frameLimit(options)}
 async *[Symbol.asyncIterator]():AsyncIterator<unknown>{
  let pending=Buffer.alloc(0);
  for await(const chunk of this.#input){
   const bytes=typeof chunk==="string"?Buffer.from(chunk,"utf8"):Buffer.from(chunk as Uint8Array);
   pending=pending.length===0?bytes:Buffer.concat([pending,bytes],pending.length+bytes.length);
   if(pending.length>this.#maxFrameBytes&&!pending.includes(0x0a))throw new RangeError("JSON-RPC frame exceeds maximum size");
   let newline:number;
   while((newline=pending.indexOf(0x0a))!==-1){
    let frame=pending.subarray(0,newline);pending=pending.subarray(newline+1);
    if(frame.length>0&&frame[frame.length-1]===0x0d)frame=frame.subarray(0,frame.length-1);
    if(frame.length===0)continue;
    if(frame.length>this.#maxFrameBytes)throw new RangeError("JSON-RPC frame exceeds maximum size");
    let value:unknown;
    try{value=JSON.parse(frame.toString("utf8")) as unknown}catch{throw new SyntaxError("Malformed JSON-RPC frame")}
    yield value;
   }
   if(pending.length>this.#maxFrameBytes)throw new RangeError("JSON-RPC frame exceeds maximum size");
  }
  if(pending.length!==0)throw new SyntaxError("Incomplete JSON-RPC frame");
 }
}

/** Writes one JSON value per UTF-8 line and observes stream backpressure. */
export class JsonRpcFramedWriter{
 readonly #output:Writable;
 readonly #maxFrameBytes:number;
 constructor(output:Writable,options:JsonRpcFramingOptionsV1={}){this.#output=output;this.#maxFrameBytes=frameLimit(options)}
 async write(value:unknown):Promise<void>{
  let encoded:string;
  try{encoded=JSON.stringify(value)}catch{throw new TypeError("JSON-RPC frame is not JSON serializable")}
  if(encoded===undefined)throw new TypeError("JSON-RPC frame is not JSON serializable");
  const frame=Buffer.from(`${encoded}\n`,"utf8");
  if(frame.length-1>this.#maxFrameBytes)throw new RangeError("JSON-RPC frame exceeds maximum size");
  if(!this.#output.write(frame))await once(this.#output,"drain");
 }
}
