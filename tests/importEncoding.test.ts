import { test } from "node:test";
import assert from "node:assert/strict";
import { readImportFile } from "../src/importEncoding.ts";
test("imports UTF-8 and legacy Chinese TFD without replacing bytes",async()=>{
 const utf=await readImportFile(new File(["COMMENTS*光谱*"],"test.tfd"));assert.equal(utf.content,"COMMENTS*光谱*");
 const legacy=await readImportFile(new File([new Uint8Array([0xbb,0xf9,0xb5,0xd7])],"legacy.TFD"));assert.equal(legacy.content,"基底");assert.equal(legacy.encoding,"gb18030");
 await assert.rejects(readImportFile(new File([new Uint8Array([0xff])],"bad.tfd")));
 await assert.rejects(readImportFile(new File([new Uint8Array([0xbb,0xf9])],"bad.json")));
});
