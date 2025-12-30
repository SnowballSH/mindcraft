import { FirstDeathTimeMetric } from './m_first_death_time.js';
import { WoodCollectionSuccessMetric } from './m_wood_collection_success.js';
import { TimeToGoalMetric } from './m_time_to_goal.js';

export function getMetricRegistry() {
  return [
    new FirstDeathTimeMetric(),
    new WoodCollectionSuccessMetric(),
    new TimeToGoalMetric(),
  ];
}


