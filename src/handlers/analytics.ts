import { AppStoreConnectClient } from '../services/index.js';
import { 
  AnalyticsReportRequest,
  AnalyticsReportRequestResponse,
  ListAnalyticsReportsResponse,
  ListAnalyticsReportSegmentsResponse,
  AnalyticsAccessType,
  AnalyticsReportCategory,
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

  async listAnalyticsReportSegments(args: {
    reportId: string;
    limit?: number;
  }): Promise<ListAnalyticsReportSegmentsResponse> {
    const { reportId, limit = 100 } = args;
    
    validateRequired(args, ['reportId']);

    return this.client.get<ListAnalyticsReportSegmentsResponse>(`/analyticsReports/${reportId}/segments`, {
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

    return this.client.get<SalesReportResponse>('/salesReports', buildFilterParams(filters));
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

    return this.client.get<FinanceReportResponse>('/financeReports', buildFilterParams(filters));
  }
}