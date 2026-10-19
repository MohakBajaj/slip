import koffi from "koffi";

import type { PasteFlavor, PasteItem, PasteSnap } from "../shared/capture-clip";

export interface Pasteboard {
  changeCount: () => number;
  read: () => PasteSnap;
  write: (snap: PasteSnap) => void;
}

type Id = (self: unknown, sel: unknown) => unknown;
type IdArg = (self: unknown, sel: unknown, arg: unknown) => unknown;
type IdCStr = (self: unknown, sel: unknown, arg: string) => unknown;
type IdIndex = (self: unknown, sel: unknown, index: number) => unknown;
type IdPtrLen = (
  self: unknown,
  sel: unknown,
  bytes: Uint8Array,
  length: number
) => unknown;
type I64 = (self: unknown, sel: unknown) => number | bigint;
type U64 = (self: unknown, sel: unknown) => number | bigint;
type BoolArg = (self: unknown, sel: unknown, arg: unknown) => number;
type Bool2 = (
  self: unknown,
  sel: unknown,
  left: unknown,
  right: unknown
) => number;

interface Objc {
  NSAutoreleasePool: unknown;
  NSData: unknown;
  NSMutableArray: unknown;
  NSPasteboard: unknown;
  NSPasteboardItem: unknown;
  NSString: unknown;
  bool2: Bool2;
  boolArg: BoolArg;
  i64: I64;
  id: Id;
  idArg: IdArg;
  idCStr: IdCStr;
  idIndex: IdIndex;
  idPtrLen: IdPtrLen;
  sel: (name: string) => unknown;
  u64: U64;
}

const countOf = (value: number | bigint): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.trunc(n);
};

const copyBytes = (ptr: unknown, length: number): Uint8Array => {
  if (!ptr || length <= 0) {
    return new Uint8Array();
  }
  return new Uint8Array(koffi.view(ptr, length)).slice();
};

const copyString = (ptr: unknown): string => {
  if (!ptr) {
    return "";
  }
  return koffi.decode.string(ptr);
};

let objc: Objc | null = null;

const loadObjc = (): Objc => {
  if (objc) {
    return objc;
  }
  koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit", {
    global: true,
  });
  const lib = koffi.load("/usr/lib/libobjc.A.dylib");
  const getClass = lib.func("void *objc_getClass(const char *name)") as (
    name: string
  ) => unknown;
  const register = lib.func("void *sel_registerName(const char *name)") as (
    name: string
  ) => unknown;
  const classes = {
    NSAutoreleasePool: getClass("NSAutoreleasePool"),
    NSData: getClass("NSData"),
    NSMutableArray: getClass("NSMutableArray"),
    NSPasteboard: getClass("NSPasteboard"),
    NSPasteboardItem: getClass("NSPasteboardItem"),
    NSString: getClass("NSString"),
  };
  if (Object.values(classes).some((cls) => !cls)) {
    throw new Error("NSPasteboard is unavailable");
  }
  const selectors = new Map<string, unknown>();
  objc = {
    ...classes,
    bool2: lib.func(
      "int8 objc_msgSend(void *self, void *sel, void *a, void *b)"
    ) as Bool2,
    boolArg: lib.func(
      "int8 objc_msgSend(void *self, void *sel, void *a)"
    ) as BoolArg,
    i64: lib.func("int64 objc_msgSend(void *self, void *sel)") as I64,
    id: lib.func("void *objc_msgSend(void *self, void *sel)") as Id,
    idArg: lib.func(
      "void *objc_msgSend(void *self, void *sel, void *a)"
    ) as IdArg,
    idCStr: lib.func(
      "void *objc_msgSend(void *self, void *sel, const char *a)"
    ) as IdCStr,
    idIndex: lib.func(
      "void *objc_msgSend(void *self, void *sel, uint64 idx)"
    ) as IdIndex,
    idPtrLen: lib.func(
      "void *objc_msgSend(void *self, void *sel, void *bytes, uint64 len)"
    ) as IdPtrLen,
    sel: (name: string) => {
      const cached = selectors.get(name);
      if (cached) {
        return cached;
      }
      const value = register(name);
      selectors.set(name, value);
      return value;
    },
    u64: lib.func("uint64 objc_msgSend(void *self, void *sel)") as U64,
  };
  return objc;
};

const withPool = <T>(api: Objc, fn: () => T): T => {
  const pool = api.id(
    api.id(api.NSAutoreleasePool, api.sel("alloc")),
    api.sel("init")
  );
  try {
    return fn();
  } finally {
    api.id(pool, api.sel("drain"));
  }
};

const general = (api: Objc): unknown => {
  const pb = api.id(api.NSPasteboard, api.sel("generalPasteboard"));
  if (!pb) {
    throw new Error("NSPasteboard is unavailable");
  }
  return pb;
};

const readSnap = (api: Objc): PasteSnap =>
  withPool(api, () => {
    const itemsRef = api.id(general(api), api.sel("pasteboardItems"));
    if (!itemsRef) {
      return { items: [] };
    }
    const count = countOf(api.u64(itemsRef, api.sel("count")));
    const items: PasteItem[] = [];
    for (let i = 0; i < count; i += 1) {
      const item = api.idIndex(itemsRef, api.sel("objectAtIndex:"), i);
      const typesRef = item ? api.id(item, api.sel("types")) : null;
      const flavors: PasteFlavor[] = [];
      const typeCount = typesRef
        ? countOf(api.u64(typesRef, api.sel("count")))
        : 0;
      for (let j = 0; j < typeCount; j += 1) {
        const typeRef = api.idIndex(typesRef, api.sel("objectAtIndex:"), j);
        const type = copyString(
          typeRef ? api.id(typeRef, api.sel("UTF8String")) : null
        );
        if (!type || !item) {
          continue;
        }
        const dataRef = api.idArg(item, api.sel("dataForType:"), typeRef);
        const length = dataRef
          ? countOf(api.u64(dataRef, api.sel("length")))
          : 0;
        const bytes = dataRef ? api.id(dataRef, api.sel("bytes")) : null;
        flavors.push({ data: copyBytes(bytes, length), type });
      }
      items.push({ flavors });
    }
    return { items };
  });

const nsData = (api: Objc, bytes: Uint8Array): unknown => {
  const payload = bytes.byteLength === 0 ? Uint8Array.of(0) : bytes;
  return api.idPtrLen(
    api.NSData,
    api.sel("dataWithBytes:length:"),
    payload,
    bytes.byteLength
  );
};

const writeSnap = (api: Objc, snap: PasteSnap): void => {
  withPool(api, () => {
    const pb = general(api);
    api.i64(pb, api.sel("clearContents"));
    if (snap.items.length === 0) {
      return;
    }
    const arr = api.id(api.NSMutableArray, api.sel("array"));
    const owned: unknown[] = [];
    try {
      for (const item of snap.items) {
        const pbItem = api.id(
          api.id(api.NSPasteboardItem, api.sel("alloc")),
          api.sel("init")
        );
        if (!pbItem) {
          continue;
        }
        owned.push(pbItem);
        for (const flavor of item.flavors) {
          const data = nsData(api, flavor.data);
          const type = api.idCStr(
            api.NSString,
            api.sel("stringWithUTF8String:"),
            flavor.type
          );
          if (!data || !type) {
            continue;
          }
          api.bool2(pbItem, api.sel("setData:forType:"), data, type);
        }
        api.idArg(arr, api.sel("addObject:"), pbItem);
      }
      if (!api.boolArg(pb, api.sel("writeObjects:"), arr)) {
        throw new Error("NSPasteboard writeObjects failed");
      }
    } finally {
      for (const item of owned) {
        api.id(item, api.sel("release"));
      }
    }
  });
};

export const createMacPasteboard = (): Pasteboard => {
  const api = loadObjc();
  return {
    changeCount: () => countOf(api.i64(general(api), api.sel("changeCount"))),
    read: () => readSnap(api),
    write: (snap: PasteSnap) => {
      writeSnap(api, snap);
    },
  };
};
