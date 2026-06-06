import React from 'react';
import {
	useCurrentFrame,
	useVideoConfig,
	interpolate,
	spring,
	Easing,
} from 'remotion';

interface AnimationProps {
	frame: number;
	durationInFrames: number;
	width: number;
	height: number;
	subtitleSafeBottom: number;
	theme: Record<string, string>;
	fps: number;
}

const ACCENT = '#58a6ff';
const BG_DARK = '#0d1117';
const CARD_BG = '#161b22';
const BORDER_DEFAULT = '#30363d';
const GRID_LINE = '#21262d';
const TEXT_MUTED = '#8b949e';
const TEXT_WHITE = '#ffffff';

const GRID_SPACING = 40;
const WORLD_EXTENT = 300;

const CAR_BODY_W = 54;
const CAR_BODY_H = 28;
const CAR_ROOF_W = 28;
const CAR_ROOF_H = 14;
const CAR_WHEEL_R = 5;

const CAM_BODY_W = 32;
const CAM_BODY_H = 26;
const CAM_LENS_R = 7;

const ViewTransformSlide: React.FC<AnimationProps> = ({
	subtitleSafeBottom,
}) => {
	const frame = useCurrentFrame();
	const { fps, width, height } = useVideoConfig();

	// ---- Timing (all relative to fps) ----
	const FADE_DUR = fps * 1;
	const S1_START = fps * 1;
	const S1_DUR = fps * 2;
	const S2_START = fps * 3;
	const S2_DUR = fps * 2;
	const S3_START = fps * 5;
	const S3_DUR = fps * 1.5;

	// ---- Entrance fade ----
	const fadeOpacity = interpolate(
		frame,
		[0, FADE_DUR],
		[0, 1],
		{ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
	);

	// ---- Spring-based transitions ----
	const translateSpring = spring({
		frame: Math.max(0, frame - S1_START),
		fps,
		config: { damping: 16, stiffness: 100, mass: 0.8 },
	});
	const rotateSpring = spring({
		frame: Math.max(0, frame - S2_START),
		fps,
		config: { damping: 16, stiffness: 100, mass: 0.8 },
	});
	const scaleSpring = spring({
		frame: Math.max(0, frame - S3_START),
		fps,
		config: { damping: 22, stiffness: 180, mass: 0.6 },
	});

	// ---- World / camera setup ----
	const padding = Math.min(width, height) * 0.05;
	const leftPanelW = width * 0.48;
	const rightPanelW = width * 0.46;
	const gap = width * 0.06;

	const usableH = height - padding * 2 - subtitleSafeBottom;
	const gridSize = Math.min(leftPanelW, usableH) * 0.88;

	// Camera in world coords (centered on grid, Y-down screen coords)
	const camWX = 160;
	const camWY = -120;
	const camInitAngleDeg = 150;

	// Car in world coords
	const carWX = -90;
	const carWY = 140;

	// Scale factor: world units → pixels inside the grid
	const ws = gridSize / (WORLD_EXTENT * 2);

	const camPX = camWX * ws;
	const camPY = camWY * ws;
	const carPX = carWX * ws;
	const carPY = carWY * ws;

	// ---- Computed transform values ----
	const tx = interpolate(translateSpring, [0, 1], [0, -camPX], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const ty = interpolate(translateSpring, [0, 1], [0, -camPY], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const rot = interpolate(rotateSpring, [0, 1], [0, -60], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const sx = interpolate(scaleSpring, [0, 1], [1, -1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	// ---- Mirror flash overlay ----
	const flashOpacity = interpolate(
		scaleSpring,
		[0, 0.15, 0.4, 0.7],
		[0, 0.4, 0.18, 0],
		{ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
	);

	// ---- Step activation helpers ----
	const stepState = (n: number): 'inactive' | 'active' | 'done' => {
		if (n === 1) {
			if (frame >= S2_START) return 'done';
			if (frame >= S1_START) return 'active';
			return 'inactive';
		}
		if (n === 2) {
			if (frame >= S3_START) return 'done';
			if (frame >= S2_START) return 'active';
			return 'inactive';
		}
		if (n === 3) {
			if (frame >= S3_START) return 'active';
			return 'inactive';
		}
		return 'inactive';
	};

	// ---- Grid lines ----
	const gridLines: React.ReactNode[] = [];
	const halfExtent = WORLD_EXTENT;
	const steps = Math.ceil(halfExtent / GRID_SPACING);
	for (let i = -steps; i <= steps; i++) {
		const pos = i * GRID_SPACING * ws;
		if (i !== 0) {
			gridLines.push(
				<line
					key={`v${i}`}
					x1={pos}
					y1={-halfExtent * ws}
					x2={pos}
					y2={halfExtent * ws}
					stroke={GRID_LINE}
					strokeWidth={1}
				/>,
				<line
					key={`h${i}`}
					x1={-halfExtent * ws}
					y1={pos}
					x2={halfExtent * ws}
					y2={pos}
					stroke={GRID_LINE}
					strokeWidth={1}
				/>,
			);
		}
	}
	// Axes (slightly brighter)
	gridLines.push(
		<line
			key="v0"
			x1={0}
			y1={-halfExtent * ws}
			x2={0}
			y2={halfExtent * ws}
			stroke="#30363d"
			strokeWidth={1}
		/>,
		<line
			key="h0"
			x1={-halfExtent * ws}
			y1={0}
			x2={halfExtent * ws}
			y2={0}
			stroke="#30363d"
			strokeWidth={1}
		/>,
	);

	// ---- Sizes for icons ----
	const carScale = ws * 1.1;
	const camScale = ws * 1.1;

	// ---- Styles ----
	const container: React.CSSProperties = {
		width,
		height,
		backgroundColor: BG_DARK,
		display: 'flex',
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		padding: `0 ${padding}px ${subtitleSafeBottom}px ${padding}px`,
		gap: gap,
		fontFamily: 'system-ui, -apple-system, sans-serif',
		opacity: fadeOpacity,
		overflow: 'hidden',
		position: 'relative',
	};

	const leftPanel: React.CSSProperties = {
		width: leftPanelW,
		height: usableH,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		flexShrink: 0,
	};

	const gridContainer: React.CSSProperties = {
		width: gridSize,
		height: gridSize,
		border: '1px solid #30363d',
		borderRadius: 4,
		position: 'relative',
		overflow: 'hidden',
		backgroundColor: '#0d1117',
	};

	const groupStyle: React.CSSProperties = {
		position: 'absolute',
		left: gridSize / 2,
		top: gridSize / 2,
		transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scaleX(${sx})`,
		transformOrigin: '0px 0px',
		width: 0,
		height: 0,
	};

	const crosshairStyle: React.CSSProperties = {
		position: 'absolute',
		left: '50%',
		top: '50%',
		transform: 'translate(-50%, -50%)',
		width: 20,
		height: 20,
		zIndex: 5,
		pointerEvents: 'none',
	};

	const flashOverlayStyle: React.CSSProperties = {
		position: 'absolute',
		inset: 0,
		backgroundColor: '#ffffff',
		opacity: flashOpacity,
		pointerEvents: 'none',
		zIndex: 10,
	};

	const rightPanel: React.CSSProperties = {
		width: rightPanelW,
		height: usableH,
		display: 'flex',
		flexDirection: 'column',
		justifyContent: 'center',
		gap: height * 0.03,
		flexShrink: 0,
	};

	const cardHeight = Math.min(
		height * 0.11,
		(usableH - height * 0.06) / 3,
	);

	const stepFontSize = height * 0.028;
	const stepNumberSize = height * 0.035;
	const sublabelSize = height * 0.018;

	const makeCardStyle = (
		n: number,
	): React.CSSProperties => {
		const state = stepState(n);
		const isActive = state === 'active';
		const isDone = state === 'done';
		return {
			height: cardHeight,
			borderRadius: 8,
			backgroundColor: CARD_BG,
			borderLeft: isActive
				? `4px solid ${ACCENT}`
				: `1px solid ${BORDER_DEFAULT}`,
			padding: `0 ${height * 0.025}px`,
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'center',
			transition: 'none',
			transform: isActive ? 'scale(1.03)' : 'scale(1)',
			opacity: isDone ? 1 : isActive ? 1 : 0.65,
			color: isActive || isDone ? TEXT_WHITE : TEXT_MUTED,
			position: 'relative',
			overflow: 'hidden',
		} as React.CSSProperties;
	};

	const cardRow: React.CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		gap: height * 0.018,
	};

	const numBadge: React.CSSProperties = {
		fontSize: stepNumberSize,
		fontWeight: 700,
		color: ACCENT,
		flexShrink: 0,
		width: stepNumberSize * 1.4,
		textAlign: 'center',
	};

	const cardText: React.CSSProperties = {
		fontSize: stepFontSize,
		lineHeight: 1.3,
		fontWeight: 500,
		margin: 0,
	};

	// ---- Helper: draw grid crosshair at origin ----
	const crosshairSize = gridSize * 0.035;
	const chHalf = crosshairSize / 2;

	return (
		<div style={container}>
			{/* ---- LEFT: Grid panel ---- */}
			<div style={leftPanel}>
				<div style={gridContainer}>
					{/* Moving world group */}
					<div style={groupStyle}>
						<svg
							width={halfExtent * ws * 2}
							height={halfExtent * ws * 2}
							viewBox={`${-halfExtent * ws} ${-halfExtent * ws} ${halfExtent * ws * 2} ${halfExtent * ws * 2}`}
							style={{ position: 'absolute', left: 0, top: 0 }}
						>
							{gridLines}

							{/* Car icon */}
							<g transform={`translate(${carPX}, ${carPY})`}>
								<rect
									x={-CAR_BODY_W * carScale * 0.5}
									y={-CAR_BODY_H * carScale * 0.5}
									width={CAR_BODY_W * carScale}
									height={CAR_BODY_H * carScale}
									rx={4}
									fill={ACCENT}
									opacity={0.9}
								/>
								<rect
									x={-CAR_ROOF_W * carScale * 0.5}
									y={-CAR_BODY_H * carScale * 0.5 - CAR_ROOF_H * carScale * 0.7}
									width={CAR_ROOF_W * carScale}
									height={CAR_ROOF_H * carScale}
									rx={2}
									fill={ACCENT}
									opacity={0.9}
								/>
								<circle
									cx={-CAR_BODY_W * carScale * 0.3}
									cy={CAR_BODY_H * carScale * 0.4}
									r={CAR_WHEEL_R * carScale}
									fill={BG_DARK}
								/>
								<circle
									cx={CAR_BODY_W * carScale * 0.3}
									cy={CAR_BODY_H * carScale * 0.4}
									r={CAR_WHEEL_R * carScale}
									fill={BG_DARK}
								/>
							</g>

							{/* Camera icon */}
							<g transform={`translate(${camPX}, ${camPY}) rotate(${camInitAngleDeg})`}>
								{/* Direction arrow */}
								<polygon
									points={`0,${-CAM_BODY_H * camScale * 0.5 - 14 * camScale} ${-8 * camScale},${-CAM_BODY_H * camScale * 0.5 - 3 * camScale} ${8 * camScale},${-CAM_BODY_H * camScale * 0.5 - 3 * camScale}`}
									fill={TEXT_WHITE}
								/>
								{/* Camera body */}
								<rect
									x={-CAM_BODY_W * camScale * 0.5}
									y={-CAM_BODY_H * camScale * 0.5}
									width={CAM_BODY_W * camScale}
									height={CAM_BODY_H * camScale}
									rx={4}
									fill={TEXT_WHITE}
								/>
								{/* Lens */}
								<circle
									cx={0}
									cy={0}
									r={CAM_LENS_R * camScale}
									fill={BG_DARK}
									opacity={0.5}
								/>
								<circle
									cx={0}
									cy={0}
									r={CAM_LENS_R * camScale * 0.6}
									fill={BG_DARK}
									opacity={0.3}
								/>
							</g>
						</svg>
					</div>

					{/* Fixed crosshair at panel center */}
					<div style={crosshairStyle}>
						<svg width={crosshairSize} height={crosshairSize} viewBox="0 0 20 20">
							<line x1={10} y1={0} x2={10} y2={20} stroke={ACCENT} strokeWidth={2} />
							<line x1={0} y1={10} x2={20} y2={10} stroke={ACCENT} strokeWidth={2} />
							<circle cx={10} cy={10} r={2} fill={ACCENT} />
						</svg>
					</div>

					{/* Mirror flash */}
					<div style={flashOverlayStyle} />
				</div>
			</div>

			{/* ---- RIGHT: Step cards ---- */}
			<div style={rightPanel}>
				{[
					['1.', '把世界平移，让相机到原点'],
					['2.', '把世界旋转，抵消相机朝向'],
					['3.', '翻转 Z 轴：左手系 → 观察系'],
				].map(([num, text], i) => {
					const n = i + 1;
					const state = stepState(n);
					const isActive = state === 'active';
					const isDone = state === 'done';

					return (
						<div key={n} style={makeCardStyle(n)}>
							<div style={cardRow}>
								<div style={numBadge}>{num}</div>
								<p style={cardText}>{text}</p>
							</div>
							{/* Subtle progress bar at bottom of active card */}
							{isActive && (
								<div
									style={{
										position: 'absolute',
										bottom: 0,
										left: 0,
										height: 3,
										backgroundColor: ACCENT,
										borderRadius: '0 0 8px 8px',
										transition: 'none',
									} as React.CSSProperties}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export default ViewTransformSlide;
