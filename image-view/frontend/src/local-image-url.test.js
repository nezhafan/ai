import test from "node:test";
import assert from "node:assert/strict";

import { buildLocalImageURL, shouldRevokeObjectURL } from "./local-image-url.js";

test("buildLocalImageURL encodes an absolute path into the local-file route", () => {
  assert.equal(
    buildLocalImageURL("/Users/demo/Pictures/a b+c#.jpg"),
    "/local-file?path=%2FUsers%2Fdemo%2FPictures%2Fa%20b%2Bc%23.jpg"
  );
});

test("shouldRevokeObjectURL only revokes blob URLs", () => {
  assert.equal(shouldRevokeObjectURL("blob:http://localhost/123"), true);
  assert.equal(shouldRevokeObjectURL("/local-file?path=%2Ftmp%2Fa.jpg"), false);
  assert.equal(shouldRevokeObjectURL(""), false);
});
