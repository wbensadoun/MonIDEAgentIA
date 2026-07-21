/**
 * AgentVerse — shared domain types.
 *
 * The whole module is driven by these types. One engine state feeds several
 * visual themes, so anything theme-specific lives in `ThemeMeta`, never in the
 * agent/task models themselves.
 */

/** Roles exposed in the RPG world (the 6 the product showcases). */
export type AgentRoleKey =
  | 'pm'
  | 'ux'
  | 'frontend'
  | 'backend'
  | 'qa'
  | 'devops';

/** Runtime state of an agent — drives animation, bubbles and the roster. */
export type AgentStatus =
  | 'idle'
  | 'walking'
  | 'working'
  | 'talking'
  | 'blocked';

/** Which way a sprite faces (only meaningful for the grid/town theme). */
export type Facing = 'down' | 'up' | 'left' | 'right';

/** Continuous world coordinates, expressed in grid cells (0..cols, 0..rows). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Palette used to paint the parametric avatar (flat SVG or pixel sprite). */
export interface AvatarPalette {
  skin: string;
  hair: string;
  outfit: string;
  accent: string;
}

/** A transient speech bubble shown above an agent. */
export interface Bubble {
  id: string;
  text: string;
  kind: 'idle' | 'work' | 'react' | 'talk' | 'done';
  /** Epoch ms after which the bubble auto-dismisses. */
  until: number;
}

/** One line of the per-agent conversation thread. */
export interface ChatMessage {
  id: string;
  from: 'user' | 'agent' | 'system';
  text: string;
  ts: number;
}

/** A team member living in the world. */
export interface Agent {
  id: string;
  /** Display name, e.g. "Mia". */
  name: string;
  /** Human-readable role, e.g. "UX Designer". */
  role: string;
  /** Stable role key used by the RPG layer. */
  roleKey: AgentRoleKey;
  /** Maps to the existing multiAgentConfig role key (ux, frontend, apiData…). */
  systemRoleKey: string;
  /** One-liner shown in the roster / dialogue header. */
  blurb: string;
  accent: string;
  palette: AvatarPalette;
  /** Desk / station the agent returns to when working. Grid cell coords. */
  home: Vec2;
  /** Current position (continuous). */
  pos: Vec2;
  /** Where the agent is currently heading. */
  target: Vec2;
  facing: Facing;
  status: AgentStatus;
  /** Active bubble, if any. */
  bubble: Bubble | null;
  /** Work progress 0..1 while `status === 'working'`. */
  progress: number;
  /** Per-agent conversation history. */
  chat: ChatMessage[];
}

/** Kanban status for the shared task board. */
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type TaskTag = 'feature' | 'bug' | 'chore' | 'design';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  tag: TaskTag;
  /** Agent id the task is assigned to (if any). */
  assigneeId: string | null;
  createdAt: number;
}

/** Identifier of a visual theme. */
export type ThemeId = 'town' | 'cyberpunk' | 'isometric' | 'campus' | 'synthwave' | 'tamers';

/** Everything a theme needs to lay out + skin the same world state. */
export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Grid = discrete tile hops. Free = continuous wandering. */
  movement: 'grid' | 'free';
  cols: number;
  rows: number;
  accent: string;
  /** Renders avatars as blocky pixel sprites instead of flat SVG. */
  pixel: boolean;
  /** Short marketing label for the theme switcher. */
  badge: string;
}

/** Aggregate KPIs shown in the topbar (à la "AGENT_OS"). */
export interface WorldKpis {
  shipped: number;
  goal: number;
  bugs: number;
  /** 0..100 */
  completion: number;
}

/** Result returned by the (pluggable) agent backend for one instruction. */
export interface InstructionResult {
  taskTitle: string;
  reply: string;
  /** How long the agent should appear to "work", in ms. */
  durationMs: number;
}

/**
 * Seam for connecting real LLM agents later. The mock implementation simulates
 * a reply locally; a real one would call the Electron bridge / an HTTP API.
 */
export interface AgentClient {
  sendInstruction(agent: Agent, prompt: string): Promise<InstructionResult>;
}
