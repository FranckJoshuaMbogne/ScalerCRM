/** The JSON body of every webhook request. */
export type EventRow = {
  business_id: string;
  event_id: number;
  event_type: string;
  data: unknown;
  event_created_at: string;
};

export type EventEnvelope = {
  id: string;
  object: "event";
  type: string;
  api_version: "v1";
  created_at: string;
  business_id: string;
  data: unknown;
};

export function eventEnvelope(row: EventRow): EventEnvelope {
  return {
    id: `evt_${row.event_id}`,
    object: "event",
    type: row.event_type,
    api_version: "v1",
    created_at: row.event_created_at,
    business_id: row.business_id,
    data: row.data,
  };
}
