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
import { validateRequired, sanitizeLimit, buildFilterParams } from '../utils/index.js';

export class AnalyticsHandlers {
  constructor(private client: AppStoreConnectClient, private config?: { vendorNumber?: string }) {}

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

  // Apple forbids GET_COLLECTION on /analyticsReportRequests, so the only way
  // to recover an existing request's ID (create just 409s "already have such
  // an entity") is via the app -> requests relationship.
  async listAnalyticsReportRequests(args: {
    appId: string;
    limit?: number;
  }): Promise<ListAnalyticsReportRequestsResponse> {
    const { appId, limit = 100 } = args;

    validateRequired(args, ['appId']);

    return this.client.get<ListAnalyticsReportRequestsResponse>(`/apps/${appId}/analyticsReportRequests`, {
      limit: sanitizeLimit(limit)
    });
  }

  async listAnalyticsReports(args: {
    reportRequestId: string;
    limit?: number;
    filter?: {
      category?: AnalyticsReportCategory;
    };
  }): Promise<ListAnalyticsReportsResponse> {
    const { reportRequestId, limit = 100, filter } = args;
    
    validateRequired(args, ['reportRequestId']);

    const params: Record<string, any> = {
      limit: sanitizeLimit(limit)
    };

    Object.assign(params, buildFilterParams(filter));

    return this.client.get<ListAnalyticsReportsResponse>(`/analyticsReportRequests/${reportRequestId}/reports`, params);
  }

  // A report has one instance per (granularity, processingDate). Apple
  // generates instances asynchronously after the request is created
  // (hours -> ~a day), so an empty list means "not ready yet", not "no data".
  async listAnalyticsReportInstances(args: {
    reportId: string;
    limit?: number;
    filter?: {
      granularity?: AnalyticsReportGranularity;
      processingDate?: string;
    };
  }): Promise<ListAnalyticsReportInstancesResponse> {
    const { reportId, limit = 100, filter } = args;

    validateRequired(args, ['reportId']);

    const params: Record<string, any> = {
      limit: sanitizeLimit(limit)
    };

    Object.assign(params, buildFilterParams(filter));

    return this.client.get<ListAnalyticsReportInstancesResponse>(`/analyticsReports/${reportId}/instances`, params);
  }

  // Segments hang off an *instance*, not the report. The old
  // /analyticsReports/{id}/segments path 404s ("relationship 'segments' ...").
  async listAnalyticsReportSegments(args: {
    instanceId: string;
    limit?: number;
  }): Promise<ListAnalyticsReportSegmentsResponse> {
    const { instanceId, limit = 100 } = args;

    validateRequired(args, ['instanceId']);

    return this.client.get<ListAnalyticsReportSegmentsResponse>(`/analyticsReportInstances/${instanceId}/segments`, {
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
      SALES: "1_1",
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
  }): Promise<FinanceReportResponse> {
    const { vendorNumber = this.config?.vendorNumber, reportDate, regionCode } = args;
    
    if (!vendorNumber) {
      throw new Error('Vendor number is required. Please provide it as an argument or set APP_STORE_CONNECT_VENDOR_NUMBER environment variable.');
    }
    
    validateRequired({ reportDate, regionCode }, ['reportDate', 'regionCode']);

    const filters: FinanceReportFilters = {
      reportDate,
      regionCode,
      vendorNumber
    };

    return this.client.getGzipReport('/financeReports', buildFilterParams(filters));
  }
}