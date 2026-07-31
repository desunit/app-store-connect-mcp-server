import { AppStoreConnectClient } from '../services/index.js';
import {
  AnalyticsReportRequest,
  AnalyticsReportRequestResponse,
  ListAnalyticsReportRequestsResponse,
  ListAnalyticsReportsResponse,
  ListAnalyticsReportInstancesResponse,
  ListAnalyticsReportSegmentsResponse,
  AnalyticsAccessType,
  AnalyticsReportCategory,
  AnalyticsReportGranularity,
  SalesReportResponse,
  FinanceReportResponse,
  SalesReportType,
  SalesReportSubType,
  SalesReportFrequency,
  SalesReportFilters,
  FinanceReportFilters
} from '../types/index.js';
import { validateRequired, sanitizeLimit, buildFilterParams, buildFieldParams } from '../utils/index.js';

export class AnalyticsHandlers {
  constructor(private client: AppStoreConnectClient, private config?: { vendorNumber?: string }) {}

  // accessType decides what WINDOW of data you get, and the two are not
  // interchangeable (verified live 2026-07-31 against app 586097063):
  //
  //   ONE_TIME_SNAPSHOT — backfills HISTORY. Apple emits one instance per
  //     granularity, all stamped with the snapshot's processingDate; the
  //     segment CSV inside holds the full daily back-catalogue. The live
  //     snapshot checked covered 2024-01-01 -> 2026-07-10 (922 distinct days)
  //     in a single DAILY instance. This is the ONLY way to reconstruct the
  //     past, and it is why "the analytics API can't look backwards" is wrong.
  //   ONGOING — accrues FORWARD from creation, one instance per processing
  //     date. It cannot recover data from before the request existed.
  //
  // Practical rule: to answer a "what was it before X?" question, create a
  // ONE_TIME_SNAPSHOT (and create an ONGOING alongside it for future days).
  // Instances are generated asynchronously — hours to ~a day — so an empty
  // instance list right after creation means "not ready", not "no data".
  async createAnalyticsReportRequest(args: {
    appId: string;
    accessType?: AnalyticsAccessType;
  }): Promise<AnalyticsReportRequestResponse> {
    const { appId, accessType = "ONE_TIME_SNAPSHOT" } = args;
    
    validateRequired(args, ['appId']);

    const requestBody: AnalyticsReportRequest = {
      data: {
        type: "analyticsReportRequests",
        attributes: {
          accessType
        },
        relationships: {
          app: {
            data: {
              id: appId,
              type: "apps"
            }
          }
        }
      }
    };

    return this.client.post<AnalyticsReportRequestResponse>('/analyticsReportRequests', requestBody);
  }

  // Apple 409s on creating a second request of the same accessType ("already
  // have such an entity"), and a ONE_TIME_SNAPSHOT's instances/segments expire
  // over time — leaving a stale request that lists 0 instances and cannot be
  // refreshed. Deleting it is the only way to then re-create a fresh snapshot.
  // DELETE /analyticsReportRequests/{id} returns 204 (no body).
  async deleteAnalyticsReportRequest(args: {
    reportRequestId: string;
  }): Promise<{ success: true; deletedReportRequestId: string }> {
    const { reportRequestId } = args;

    validateRequired(args, ['reportRequestId']);

    await this.client.delete(`/analyticsReportRequests/${reportRequestId}`);
    return { success: true, deletedReportRequestId: reportRequestId };
  }

  // Apple forbids GET_COLLECTION on /analyticsReportRequests, so the only way
  // to recover an existing request's ID (create just 409s "already have such
  // an entity") is via the app -> requests relationship.
  async listAnalyticsReportRequests(args: {
    appId: string;
    limit?: number;
  }): Promise<ListAnalyticsReportRequestsResponse> {
    const { appId, limit = 100 } = args;

    validateRequired(args, ['appId']);

    return this.client.getAllPages<ListAnalyticsReportRequestsResponse>(`/apps/${appId}/analyticsReportRequests`, {
      limit: sanitizeLimit(limit)
    });
  }

  // ~156 reports hang off a single request, so the old `limit = 100` default
  // returned 100 and silently dropped 56. `limit` is now the PAGE size and
  // every page is followed; pass `filter.name` (Apple supports exact-match
  // filter[name]) or `filter.category` to narrow instead of relying on luck.
  // Product-page conversion lives in APP_STORE_ENGAGEMENT ->
  // "App Store Discovery and Engagement Standard/Detailed".
  //
  // Returning all 156 makes payload size the new failure mode (89 KB raw /
  // ~116 KB pretty-printed blew the MCP output cap), so the response is
  // slimmed two ways: a sparse fieldset (`name`,`category` are the only
  // attributes that exist) halves it, and the per-item `links`/`relationships`
  // boilerplate is stripped — every downstream call keys off `id`, which is
  // retained. Net ~5x smaller with no loss of usable information.
  async listAnalyticsReports(args: {
    reportRequestId: string;
    limit?: number;
    filter?: {
      category?: AnalyticsReportCategory;
      name?: string;
    };
  }): Promise<ListAnalyticsReportsResponse> {
    const { reportRequestId, limit = 200, filter } = args;

    validateRequired(args, ['reportRequestId']);

    const params: Record<string, any> = {
      limit: sanitizeLimit(limit),
      ...buildFieldParams({ analyticsReports: ['name', 'category'] })
    };

    Object.assign(params, buildFilterParams(filter));

    const result = await this.client.getAllPages<ListAnalyticsReportsResponse>(
      `/analyticsReportRequests/${reportRequestId}/reports`,
      params
    );

    return {
      ...result,
      data: (result.data ?? []).map(({ id, type, attributes }) => ({ id, type, attributes }))
    };
  }

  // A report has one instance per (granularity, processingDate). Apple
  // generates instances asynchronously after the request is created
  // (hours -> ~a day), so an empty list means "not ready yet", not "no data".
  //
  // Do NOT read "one DAILY instance" as "one day of data": on a
  // ONE_TIME_SNAPSHOT the single DAILY instance carries the whole historical
  // daily series inside its segments (see createAnalyticsReportRequest).
  // On an ONGOING request instances accumulate one per day, which is what
  // makes following `links.next` mandatory here past ~200 days.
  async listAnalyticsReportInstances(args: {
    reportId: string;
    limit?: number;
    filter?: {
      granularity?: AnalyticsReportGranularity;
      processingDate?: string;
    };
  }): Promise<ListAnalyticsReportInstancesResponse> {
    const { reportId, limit = 200, filter } = args;

    validateRequired(args, ['reportId']);

    const params: Record<string, any> = {
      limit: sanitizeLimit(limit)
    };

    Object.assign(params, buildFilterParams(filter));

    return this.client.getAllPages<ListAnalyticsReportInstancesResponse>(`/analyticsReports/${reportId}/instances`, params);
  }

  // Segments hang off an *instance*, not the report. The old
  // /analyticsReports/{id}/segments path 404s ("relationship 'segments' ...").
  //
  // An instance's data is SPLIT across its segments — the live snapshot
  // checked had 2, and segment[0] alone was a partial series. Always download
  // and concatenate every segment before drawing conclusions from the rows.
  async listAnalyticsReportSegments(args: {
    instanceId: string;
    limit?: number;
  }): Promise<ListAnalyticsReportSegmentsResponse> {
    const { instanceId, limit = 200 } = args;

    validateRequired(args, ['instanceId']);

    return this.client.getAllPages<ListAnalyticsReportSegmentsResponse>(`/analyticsReportInstances/${instanceId}/segments`, {
      limit: sanitizeLimit(limit)
    });
  }

  async downloadAnalyticsReportSegment(args: {
    segmentUrl: string;
  }): Promise<{ data: any; contentType: string; size: string }> {
    const { segmentUrl } = args;
    
    validateRequired(args, ['segmentUrl']);

    return this.client.downloadFromUrl(segmentUrl);
  }

  async downloadSalesReport(args: {
    vendorNumber?: string;
    reportType?: SalesReportType;
    reportSubType?: SalesReportSubType;
    frequency?: SalesReportFrequency;
    reportDate: string;
    version?: string;
  }): Promise<SalesReportResponse> {
    const {
      vendorNumber = this.config?.vendorNumber,
      reportType = "SALES",
      reportSubType = "SUMMARY",
      frequency = "MONTHLY",
      reportDate,
      version
    } = args;

    if (!vendorNumber) {
      throw new Error('Vendor number is required. Please provide it as an argument or set APP_STORE_CONNECT_VENDOR_NUMBER environment variable.');
    }

    validateRequired({ reportDate }, ['reportDate']);

    // Apple requires a report `version` and only supports certain
    // (reportType, version) pairs. Pick a sensible default per type
    // unless the caller overrides it. Subscription reports are DAILY-only.
    const defaultVersion: Record<string, string> = {
      SALES: "1_0",               // 4.3; Apple rejects 1_1 ("latest version for this report is 1_0")
      SUBSCRIPTION: "1_4",
      SUBSCRIPTION_EVENT: "1_4",
      SUBSCRIBER: "1_4",
      SUBSCRIPTION_OFFER_CODE_REDEMPTION: "1_0", // 4.3; unverified (returns "invalid vendor number" — not enabled for this account)
      INSTALLS: "1_2",            // 4.3; EU DMA "First Annual Installs" / Core Technology Fee report (MONTHLY-only, EU region) — NOT a downloads source. Latest version = 1_2
      FIRST_ANNUAL: "1_0",        // 4.3; unverified (no data to validate against — override if Apple rejects)
      WIN_BACK_ELIGIBILITY: "1_0",// 4.3; verified live (latest = 1_0, returns rows)
      NEWSSTAND: "1_0",
      PRE_ORDER: "1_0"
    };

    const filters: SalesReportFilters = {
      reportDate,
      reportType,
      reportSubType,
      frequency,
      vendorNumber,
      version: version ?? defaultVersion[reportType] ?? "1_0"
    };

    return this.client.getGzipReport('/salesReports', buildFilterParams(filters));
  }

  async downloadFinanceReport(args: {
    vendorNumber?: string;
    reportDate: string;
    regionCode: string;
    reportType?: string;
  }): Promise<FinanceReportResponse> {
    const { vendorNumber = this.config?.vendorNumber, reportDate, regionCode, reportType = "FINANCIAL" } = args;

    if (!vendorNumber) {
      throw new Error('Vendor number is required. Please provide it as an argument or set APP_STORE_CONNECT_VENDOR_NUMBER environment variable.');
    }

    validateRequired({ reportDate, regionCode }, ['reportDate', 'regionCode']);

    // Apple's /financeReports endpoint REQUIRES filter[reportType]; omitting it
    // returns HTTP 400 "The parameter 'filter[reportType]' is required". Valid
    // values: FINANCIAL (fiscal-month financial report) and FINANCE_DETAIL.
    const filters: FinanceReportFilters = {
      reportDate,
      regionCode,
      vendorNumber,
      reportType
    };

    return this.client.getGzipReport('/financeReports', buildFilterParams(filters));
  }
}