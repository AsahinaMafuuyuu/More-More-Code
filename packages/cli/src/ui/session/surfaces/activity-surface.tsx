import { ActivityView } from "../../../components/activity-view";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectActivity } from "../store/session-ui-selectors";

export function ActivitySurface() {
  const activity = useSessionUiSelector(selectActivity);
  return <ActivityView activity={activity} />;
}
