import { apiGet } from './client';
import type {
  ProtocolStateResponse,
  EpochsResponse,
  EpochWinnersResponse,
  UserTicketsResponse,
  AllTimeStatsResponse,
} from './types';

export const getProtocolState = () => apiGet<ProtocolStateResponse>('/v1/protocol/state');

export const getAllTimeStats = () => apiGet<AllTimeStatsResponse>('/v1/protocol/stats');

export const getEpochs = (cursor?: number) =>
  apiGet<EpochsResponse>(`/v1/protocol/epochs${cursor ? `?cursor=${cursor}` : ''}`);

export const getEpochWinners = (megapotId: number) =>
  apiGet<EpochWinnersResponse>(`/v1/protocol/epochs/${megapotId}/winners`);

export const getUserTickets = (wallet: string) =>
  apiGet<UserTicketsResponse>(`/v1/protocol/tickets?wallet=${wallet}`);
