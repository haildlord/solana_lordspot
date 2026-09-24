import { apiGet, apiPost } from './client';
import type { ClaimSummaryResponse, ClaimVoucherResponse } from './types';

export const getClaimSummary = (wallet: string) =>
  apiGet<ClaimSummaryResponse>(`/v1/claims/summary?wallet=${wallet}`);

export const postClaimVoucher = (wallet: string) =>
  apiPost<ClaimVoucherResponse>('/v1/claims/voucher', { wallet });
