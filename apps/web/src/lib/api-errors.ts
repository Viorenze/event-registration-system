export function describeApiError(e: { status: number; code: string; message: string }): string {
  switch (e.code) {
    case "FORBIDDEN":
      return "你没有权限执行此操作";
    case "NOT_FOUND":
      return "活动或报名不存在，或不属于该团队";
    case "REGISTRATION_CLOSED":
      return "报名已截止";
    case "EVENT_STARTED":
      return "活动已开始，无法进行此操作";
    case "EVENT_CANCELLED":
      return "活动已取消";
    case "CAPACITY_BELOW_CONFIRMED":
      return "名额不能低于当前已确认人数";
    case "INTERNAL_ERROR":
      return "服务器内部错误，请稍后重试";
    case "NETWORK_ERROR":
    case "VALIDATION":
    default:
      return e.message;
  }
}
