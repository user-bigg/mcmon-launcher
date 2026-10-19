import { ru } from '@shared/i18n/ru';
import {
  BEHAVIOR_ONLY_FIELDS,
  BEHAVIOR_TELEMETRY_TYPES,
  LAUNCH_TELEMETRY_TYPES,
  TELEMETRY_FIELDS,
  type TelemetryEventType,
  type TelemetryField,
} from '@shared/telemetry';

export interface TelemetryLine {
  type: TelemetryEventType;
  label: string;
  fields: string;
}

export function labelOf(type: TelemetryEventType, field: TelemetryField): string {
  return type === 'app.closed' && field === 'duration_s'
    ? ru.telemetry.openDuration
    : ru.telemetry.fields[field];
}

function lineOf(type: TelemetryEventType, hidden: readonly TelemetryField[]): TelemetryLine {
  const fields: readonly TelemetryField[] = TELEMETRY_FIELDS[type];
  return {
    type,
    label: ru.telemetry.events[type],
    fields: fields
      .filter((field) => !hidden.includes(field))
      .map((field) => labelOf(type, field))
      .join(', '),
  };
}

export function telemetryLines(behavior = false): TelemetryLine[] {
  return LAUNCH_TELEMETRY_TYPES.map((type) => lineOf(type, behavior ? [] : BEHAVIOR_ONLY_FIELDS));
}

export function behaviorLines(): TelemetryLine[] {
  return BEHAVIOR_TELEMETRY_TYPES.map((type) => lineOf(type, []));
}
