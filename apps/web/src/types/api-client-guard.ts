import type { apiClient } from "../lib/api-client.ts";

type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type Get = (typeof apiClient)["api"]["orgs"][":orgId"]["members"]["$get"];
type Arg = NonNullable<Parameters<Get>[0]>;

export type NotAny = Expect<IsAny<Get> extends false ? true : false>;
export type P1 = Expect<Equal<Arg["param"]["orgId"], string>>;

// @ts-expect-error orgId 必须是 string(复现 D1 的 echo: 123 实验)
export const n1: Arg = { param: { orgId: 123 } };
