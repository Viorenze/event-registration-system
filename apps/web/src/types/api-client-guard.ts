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

type PatchEvent = (typeof apiClient)["api"]["orgs"][":orgId"]["events"][":eventId"]["$patch"];
type PatchEventArg = NonNullable<Parameters<PatchEvent>[0]>;

export type NotAnyPatchEvent = Expect<IsAny<PatchEvent> extends false ? true : false>;
export type P1PatchEvent = Expect<Equal<PatchEventArg["param"]["orgId"], string>>;
export type P2PatchEvent = Expect<Equal<PatchEventArg["param"]["eventId"], string>>;

type DeleteRegistrationMe =
  (typeof apiClient)["api"]["orgs"][":orgId"]["events"][":eventId"]["registrations"]["me"]["$delete"];
type DeleteRegistrationMeArg = NonNullable<Parameters<DeleteRegistrationMe>[0]>;

export type NotAnyDeleteRegistrationMe = Expect<
  IsAny<DeleteRegistrationMe> extends false ? true : false
>;
export type P1DeleteRegistrationMe = Expect<
  Equal<DeleteRegistrationMeArg["param"]["orgId"], string>
>;
export type P2DeleteRegistrationMe = Expect<
  Equal<DeleteRegistrationMeArg["param"]["eventId"], string>
>;

type GetEventDetail = (typeof apiClient)["api"]["orgs"][":orgId"]["events"][":eventId"]["$get"];
type GetEventDetailArg = NonNullable<Parameters<GetEventDetail>[0]>;

export type NotAnyGetEventDetail = Expect<IsAny<GetEventDetail> extends false ? true : false>;
export type P1GetEventDetail = Expect<Equal<GetEventDetailArg["param"]["orgId"], string>>;
export type P2GetEventDetail = Expect<Equal<GetEventDetailArg["param"]["eventId"], string>>;

// @ts-expect-error eventId 必须是 string
export const n7: GetEventDetailArg["param"] = { orgId: "test", eventId: 123 };

type GetEventRegistrations =
  (typeof apiClient)["api"]["orgs"][":orgId"]["events"][":eventId"]["registrations"]["$get"];
type GetEventRegistrationsArg = NonNullable<Parameters<GetEventRegistrations>[0]>;

export type NotAnyGetEventRegistrations = Expect<
  IsAny<GetEventRegistrations> extends false ? true : false
>;
export type P1GetEventRegistrations = Expect<
  Equal<GetEventRegistrationsArg["param"]["orgId"], string>
>;
export type P2GetEventRegistrations = Expect<
  Equal<GetEventRegistrationsArg["param"]["eventId"], string>
>;

// @ts-expect-error eventId 必须是 string
export const n8: GetEventRegistrationsArg["param"] = { orgId: "test", eventId: 123 };

type DeleteRegistration =
  (typeof apiClient)["api"]["orgs"][":orgId"]["events"][":eventId"]["registrations"][":registrationId"]["$delete"];
type DeleteRegistrationArg = NonNullable<Parameters<DeleteRegistration>[0]>;

export type NotAnyDeleteRegistration = Expect<
  IsAny<DeleteRegistration> extends false ? true : false
>;
export type P1DeleteRegistration = Expect<Equal<DeleteRegistrationArg["param"]["orgId"], string>>;
export type P2DeleteRegistration = Expect<Equal<DeleteRegistrationArg["param"]["eventId"], string>>;
export type P3DeleteRegistration = Expect<
  Equal<DeleteRegistrationArg["param"]["registrationId"], string>
>;

// @ts-expect-error registrationId 必须是 string
export const n9: DeleteRegistrationArg["param"]["registrationId"] = 123;

type PostCancelEvent =
  (typeof apiClient)["api"]["orgs"][":orgId"]["events"][":eventId"]["cancel"]["$post"];
type PostCancelEventArg = NonNullable<Parameters<PostCancelEvent>[0]>;

export type NotAnyPostCancelEvent = Expect<IsAny<PostCancelEvent> extends false ? true : false>;
export type P1PostCancelEvent = Expect<Equal<PostCancelEventArg["param"]["orgId"], string>>;
export type P2PostCancelEvent = Expect<Equal<PostCancelEventArg["param"]["eventId"], string>>;

// @ts-expect-error eventId 必须是 string
export const n10: PostCancelEventArg["param"] = { orgId: "test", eventId: 123 };
