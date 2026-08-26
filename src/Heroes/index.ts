/**
 * Emergent heroes — agents rise through deeds; no hero recruitment menu.
 */
export type {
  Hero,
  HeroType,
  AgentTrait,
  HeroHistoryEntry,
} from './Types';
export { heroTypeLabel, MAX_HEROES_PER_PLAYER } from './Types';
export { generateHeroName } from './Names';
export { HeroSystem, preferHeroLeader } from './HeroSystem';
