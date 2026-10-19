import {
  windowFailureReport,
  type WindowFailure,
  type WindowFailureReport,
  type WindowReportContext,
} from '@shared/window-failure';

export type WindowReportSender = (report: WindowFailureReport) => Promise<unknown>;

// The site has no intake for the launcher's own failures yet. Until its API has one, there is
// nothing to send a report with, whatever the build flag says.
export const WINDOW_REPORT_INTAKE: WindowReportSender | null = null;

// One try at the moment of the failure: a report that did not leave is not kept and not resent.
export function windowReporter(
  enabled: boolean,
  sender: WindowReportSender | null,
  context: () => WindowReportContext,
): ((failure: WindowFailure) => void) | null {
  if (!enabled || sender === null) {
    return null;
  }
  return (failure): void => {
    void Promise.resolve()
      .then(() => sender(windowFailureReport(failure, context())))
      .catch(() => undefined);
  };
}
