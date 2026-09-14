/** Worker schedules the Monitoring board reports; jobs.ts reads its crons from here. */
export const MONITORING_SCHEDULE = {
  uptimeProbe: { queue: "monitoring.uptime-probe", cron: "*/5 * * * *", everyMinutes: 5 },
  prune: { queue: "monitoring.prune", cron: "30 6 * * *", hourUtc: 6, minuteUtc: 30 },
  quietReporters: { queue: "monitoring.quiet-reporters", cron: "0 15 * * *", hourUtc: 15 },
} as const;

export const SEO_SCHEDULE = {
  sweep: { queue: "seo.sweep", cron: "0 10 * * *", hourUtc: 10 },
} as const;

export const COSTS_SCHEDULE = {
  railwaySync: { queue: "costs.railway-sync", cron: "0 7 * * *", hourUtc: 7 },
} as const;
