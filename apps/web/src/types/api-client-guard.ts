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

type GetEvents = (typeof apiClient)["api"]["orgs"][":orgId"]["events"]["$get"];
type GetEventsArg = NonNullable<Parameters<GetEvents>[0]>;

export type NotAnyGetEvents = Expect<IsAny<GetEvents> extends false ? true : false>;
export type P1GetEvents = Expect<Equal<GetEventsArg["param"]["orgId"], string>>;

// @ts-expect-error orgId 必须是 string
export const n2: GetEventsArg = { param: { orgId: 123 } };

type PostEvents = (typeof apiClient)["api"]["orgs"][":orgId"]["events"]["$post"];
type PostEventsArg = NonNullable<Parameters<PostEvents>[0]>;

export type NotAnyPostEvents = Expect<IsAny<PostEvents> extends false ? true : false>;
export type P1PostEvents = Expect<Equal<PostEventsArg["param"]["orgId"], string>>;

// @ts-expect-error orgId 必须是 string
export const n3: PostEventsArg["param"] = { orgId: 123 };

export type PostEventsBodyTitle = Expect<Equal<PostEventsArg["json"]["title"], string>>;
// @ts-expect-error capacity 必须是 number
export const n4: PostEventsArg["json"]["capacity"] = "not-a-number";

type PostRegistrations =
  (typeof apiClient)["api"]["orgs"][":orgId"]["events"][":eventId"]["registrations"]["$post"];
type PostRegistrationsArg = NonNullable<Parameters<PostRegistrations>[0]>;

export type NotAnyPostRegistrations = Expect<IsAny<PostRegistrations> extends false ? true : false>;
export type P1PostRegistrations = Expect<Equal<PostRegistrationsArg["param"]["orgId"], string>>;
export type P2PostRegistrations = Expect<Equal<PostRegistrationsArg["param"]["eventId"], string>>;

// @ts-expect-error orgId 必须是 string
export const n5: PostRegistrationsArg["param"] = { orgId: 123, eventId: "test" };
// @ts-expect-error eventId 必须是 string
export const n6: PostRegistrationsArg["param"] = { orgId: "test", eventId: 123 };
