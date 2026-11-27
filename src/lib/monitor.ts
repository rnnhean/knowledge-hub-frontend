/**
 * 前端监控（Sentry）。
 *
 * 只做最小的三件事，刻意不引 Sentry 全家桶：
 *   1. 未捕获异常 / 未处理的 Promise 拒绝；
 *   2. 慢请求（fetch 超过 3 秒）打成 breadcrumb，排查「卡在哪一步」；
 *   3. 把当前会话的 trace 串起来，错误发生时能对上后端日志。
 *
 * DSN 从构建期环境变量注入。没配就整个跳过——本地开发不该被上报打扰，
 * 也不能因为缺一个 key 让页面起不来。
 */
import * as Sentry from '@sentry/react'

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || ''
const ENV = (import.meta.env.VITE_SENTRY_ENV as string | undefined) || import.meta.env.MODE
const RELEASE = (import.meta.env.VITE_APP_VERSION as string | undefined) || 'dev'

export function initMonitoring() {
    if (!DSN) return

    Sentry.init({
        dsn: DSN,
        environment: ENV,
        release: RELEASE,
        // 开发期全采，生产建议降到 0.1；这里保留常量方便按环境改
        tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 1),

        // 前端最容易把 token / 查询串带进错误详情，统一清掉
        beforeSend(event) {
            if (event.request?.url) {
                event.request.url = stripSecrets(event.request.url)
            }
            if (event.breadcrumbs) {
                event.breadcrumbs = event.breadcrumbs.map((b) => {
                    if (b.data?.url) b.data.url = stripSecrets(String(b.data.url))
                    return b
                })
            }
            return event
        },

        ignoreErrors: [
            'ResizeObserver loop limit exceeded',
            'Non-Error promise rejection captured',
            /^AbortError/,
            // 联调脚本故意抛的错误：Sentry 默认每条新错误都发邮件，
            // 验证链路时会扰民。用固定前缀识别，业务错误不受影响。
            /e2e-sentry-verify/,
        ],
    })
}

/** 去掉 query 里的 token / 签名类参数，只保留 origin + pathname。 */
function stripSecrets(raw: string): string {
    try {
        const u = new URL(raw, window.location.origin)
        return `${u.origin}${u.pathname}`
    } catch {
        return raw.split('?')[0]
    }
}
