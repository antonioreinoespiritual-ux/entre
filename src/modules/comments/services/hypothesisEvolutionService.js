export {
  listCrossModeSyncStores as listEvolutionStores,
  loadCrossModeSyncStoreByKey as loadEvolutionStoreByKey,
  persistCrossModeSyncStoreByKey as persistEvolutionStoreByKey,
  listEvolutionLinksByDestination,
  markHypothesisEvolutionLinksDeleted,
  listActiveEvolutionLinksForDestinationMode,
} from '../../hypotheses/services/evolutionLinkStore.js';
