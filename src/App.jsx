import { useState, useRef, useEffect, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import {
  auth, loginUser, registerUser, logoutUser,
  onAuthChange, saveProfile, saveHistory, loadUserData,
} from './firebase'

// Doc 3 added: Discomfort, Nerve Pain, Pressure
const SYMPTOMS = ['Soreness', 'Cramp', 'Stiffness', 'Itchiness', 'Swelling', 'Sharp Pain', 'Discomfort', 'Nerve Pain', 'Pressure']

const JOKES = [
  "Why did the skeleton go to the doctor? Because he had a funny bone.",
  "I told my doctor I broke my arm in two places. He told me to stop going to those places.",
  "Why do doctors make terrible comedians? Their jokes always need a second opinion.",
  "My back went out more than I did last weekend.",
  "I asked my knee why it was hurting. It said 'I'm just going through a rough patch.'",
  "Why did the muscle go to therapy? It had too many knots to work through.",
  "My chiropractor told me I was spine-credible. I think he was just cracking jokes.",
  "I have a joke about my rotator cuff but it's a bit of a stretch.",
  "Why don't skeletons fight each other? They don't have the guts.",
  "My doctor said I need to watch my drinking. I'm doing it now — watching myself drink.",
  "I told my doctor I keep hearing music in my ear. He said I probably have a Disney.",
  "Why did the athlete bring string to the race? To tie the muscle.",
  "I pulled a muscle laughing at my own pain. That's called a groan injury.",
  "My wrist hurts from scrolling. My doctor called it 'chronic meme strain.'",
  "Why did the knee break up with the ankle? They couldn't see eye to eye — or foot to knee.",
  "I told my doctor my shoulder hurts when I do this. He said 'then don't do that.' $300 well spent.",
  "Why was the spine always calm? It had a lot of backbone.",
  "My neck hurts from looking down at my phone. My phone said 'no regrets.'",
  "I have a joke about herniated discs but it's too slipped to tell.",
  "Why did the tendon get promoted? Because it always stayed connected under pressure.",
]

const SEV_COLOR = { high: '#e74c3c', medium: '#f39c12', low: '#2ecc71' }
const ratingColor = r => r <= 3 ? '#2ecc71' : r <= 6 ? '#f39c12' : '#e74c3c'
const ratingLabel = r => r <= 3 ? 'Mild' : r <= 6 ? 'Moderate' : 'Severe'

const labelStyle = { fontSize: '9px', fontWeight: '400', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '4px', fontFamily: "'DM Sans', sans-serif" }
const inputStyle = { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '7px 10px', color: 'rgba(255,255,255,0.7)', fontSize: '12px', fontWeight: '300', fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box' }

// ─── Mesh-based region detection
// New GLB has all nodes properly named — just ignore the base body skin (Main).
const BASE_IGNORED = new Set(['', 'Scene', 'Group1', 'Main'])

function getMeshRegionName(obj) {
  const name = obj.name
  if (!name || BASE_IGNORED.has(name)) return null
  return name
}

// ─── Camera Controller
function CameraController({ target, zoom, approachDir, orbitRef, landingMode, stopRef, resetKey }) {
  const { camera } = useThree()
  const animating = useRef(false)
  const sphericalReset = useRef(false)
  const targetCamPos = useRef(new THREE.Vector3())
  const targetLook = useRef(new THREE.Vector3())

  useEffect(() => {
    sphericalReset.current = false
    if (landingMode) {
      targetCamPos.current.set(0.45, 0.91, 0.22)
      targetLook.current.set(0, 0.91, 0.22)
    } else if (target && zoom) {
      const dir = approachDir ? approachDir.clone() : new THREE.Vector3(0, 0, 1)
      targetCamPos.current.copy(target).addScaledVector(dir, 1.4)
      const xOffset = dir.z < 0 ? -0.2 : 0.2
      targetLook.current.copy(target).add(new THREE.Vector3(xOffset, 0, 0))
    } else {
      targetCamPos.current.set(0, -0.3, 10)
      targetLook.current.set(0, -0.3, 0)
      // Arc around the model instead of cutting through it
      if (camera.position.z < 0) sphericalReset.current = true
    }
    animating.current = true
  }, [target, zoom, landingMode, resetKey])

  useFrame(() => {
    if (stopRef && stopRef.current) { animating.current = false; stopRef.current = false; sphericalReset.current = false }
    if (!animating.current) return
    const speed = landingMode ? 0.03 : (target && zoom) ? 0.08 : 0.035

    if (sphericalReset.current && orbitRef.current) {
      // Spherical lerp — keeps camera at constant distance, arcs around outside of model
      const center = targetLook.current
      const relCur = camera.position.clone().sub(center)
      const relTgt = targetCamPos.current.clone().sub(center)
      const curSph = new THREE.Spherical().setFromVector3(relCur)
      const tgtSph = new THREE.Spherical().setFromVector3(relTgt)
      curSph.radius = THREE.MathUtils.lerp(curSph.radius, tgtSph.radius, speed)
      curSph.phi    = THREE.MathUtils.lerp(curSph.phi,    tgtSph.phi,    speed)
      // Shortest-path theta wrap
      let dTheta = tgtSph.theta - curSph.theta
      if (dTheta > Math.PI)  dTheta -= 2 * Math.PI
      if (dTheta < -Math.PI) dTheta += 2 * Math.PI
      curSph.theta += dTheta * speed
      camera.position.copy(new THREE.Vector3().setFromSpherical(curSph).add(center))
      orbitRef.current.target.lerp(targetLook.current, speed)
      orbitRef.current.update()
      if (camera.position.distanceTo(targetCamPos.current) < 0.01) { animating.current = false; sphericalReset.current = false }
      return
    }

    camera.position.lerp(targetCamPos.current, speed)
    if (orbitRef.current) {
      orbitRef.current.target.lerp(targetLook.current, speed)
      orbitRef.current.update()
    }
    if (camera.position.distanceTo(targetCamPos.current) < 0.01) animating.current = false
  })

  return null
}

// ─── Body Model
const BASE_COLOR  = new THREE.Color(0.85, 0.82, 0.78)
const HOVER_COLOR = new THREE.Color(0.80, 0.12, 0.12)
const HOVER_EMIT  = new THREE.Color(0.40, 0.04, 0.04)

function BodyModel({ onPartClick, onHover, onHoverEnd, interactive, selectedRegion, highlightName }) {
  const { scene } = useGLTF('/sampleUntitled.glb')
  const { camera } = useThree()
  const pointerDown = useRef(null)
  const selectedMesh = useRef(null)

  useEffect(() => {
    scene.traverse(c => {
      if (c.isMesh) {
        c.material = new THREE.MeshStandardMaterial({
          color: BASE_COLOR.clone(), roughness: 0.75, metalness: 0.0,
          side: THREE.DoubleSide
        })
      }
    })
  }, [scene])

  useEffect(() => {
    if (!selectedRegion) {
      selectedMesh.current = null
      scene.traverse(c => {
        if (c.isMesh) {
          c.material.color.copy(BASE_COLOR)
          c.material.emissive.set(0, 0, 0)
          c.material.emissiveIntensity = 0
        }
      })
    }
  }, [selectedRegion, scene])

  // Highlight from history hover — match by resolved name
  useEffect(() => {
    if (!highlightName) return
    scene.traverse(c => {
      if (!c.isMesh) return
      const resolved = getMeshRegionName(c)
      if (resolved === highlightName) {
        c.material.color.copy(HOVER_COLOR)
        c.material.emissive.copy(HOVER_EMIT)
        c.material.emissiveIntensity = 1
      } else {
        c.material.color.copy(BASE_COLOR)
        c.material.emissive.set(0, 0, 0)
        c.material.emissiveIntensity = 0
      }
    })
  }, [highlightName, scene])

  const applyHighlight = (mesh) => {
    if (!mesh || !mesh.isMesh) return
    mesh.material.color.copy(HOVER_COLOR)
    mesh.material.emissive.copy(HOVER_EMIT)
    mesh.material.emissiveIntensity = 1
  }

  const resetAll = () => {
    scene.traverse(c => {
      if (c.isMesh) {
        c.material.color.copy(BASE_COLOR)
        c.material.emissive.set(0, 0, 0)
        c.material.emissiveIntensity = 0
      }
    })
    if (selectedMesh.current) applyHighlight(selectedMesh.current)
  }

  const highlightRegion = (hitObj) => {
    resetAll()
    const name = getMeshRegionName(hitObj)
    if (!name) return null
    if (hitObj.isMesh) applyHighlight(hitObj)
    return name
  }

  return (
    <primitive
      object={scene} scale={0.15} position={[0, -2, 0]}

      onPointerDown={interactive ? (e) => {
        pointerDown.current = { x: e.clientX, y: e.clientY }
      } : undefined}

      onClick={interactive ? (e) => {
        e.stopPropagation()
        if (!pointerDown.current) return
        const dx = e.clientX - pointerDown.current.x
        const dy = e.clientY - pointerDown.current.y
        if (Math.sqrt(dx * dx + dy * dy) > 5) return
        const name = getMeshRegionName(e.object)
        if (name) {
          selectedMesh.current = e.object
          applyHighlight(e.object)
          const dir = camera.position.clone().sub(e.point).normalize()
          onPartClick(e.point.clone(), name, dir)
        }
      } : undefined}

      onPointerMove={interactive ? (e) => {
        e.stopPropagation()
        const name = highlightRegion(e.object)
        if (name) onHover(name, e.clientX, e.clientY)
        else { resetAll(); onHoverEnd() }
      } : undefined}

      onPointerOut={interactive ? () => {
        resetAll()
        onHoverEnd()
        document.body.style.cursor = 'default'
      } : undefined}

      onPointerOver={interactive ? () => {
        document.body.style.cursor = 'pointer'
      } : undefined}
    />
  )
}

useGLTF.preload('/sampleUntitled.glb')

// ─── Annotation Panel ─────────────────────────────────────────────────────────
function AnnotationPanel({ region, regionType, setRegionType, symptom, setSymptom, customText, setCustomText, onGetRemedies, loading, onClear, remedies, historyOpen, onScanSkin, scanResult, onClearScan, isMobile }) {
  return (
    <div style={isMobile ? {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      width: '100%', maxHeight: '82dvh', overflowY: 'auto', zIndex: 200,
      background: '#0a0a0a', borderTop: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '20px 20px 0 0', padding: '20px 20px 36px',
      boxShadow: '0 -20px 60px rgba(0,0,0,0.95)',
      fontFamily: "'DM Sans', sans-serif",
    } : {
      position: 'absolute', right: historyOpen ? '420px' : '320px', top: '50%', transform: 'translateY(-50%)',
      transition: 'right 0.35s cubic-bezier(0.4,0,0.2,1)',
      width: '460px', maxHeight: '84vh', overflowY: 'auto', zIndex: 200,
      background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '20px', padding: '28px', boxShadow: '0 32px 80px rgba(0,0,0,0.95)',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: '5px' }}>Selected area</div>
          <div style={{ color: 'white', fontSize: '20px', fontWeight: '300', letterSpacing: '-0.4px' }}>{region}</div>
        </div>
        <button onClick={onClear} style={{
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)',
          color: 'rgba(255,255,255,0.3)', borderRadius: '50%', width: '28px', height: '28px',
          cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>✕</button>
      </div>
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', marginBottom: '14px' }} />

      <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: '8px' }}>Region</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {['Muscle Group', 'Bone', 'Tissue', 'General Area'].map(r => (
          <button key={r} onClick={() => setRegionType(r === regionType ? null : r)} style={{
            padding: '5px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: '300',
            fontFamily: "'DM Sans', sans-serif",
            border: `1px solid ${regionType === r ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.07)'}`,
            background: regionType === r ? 'rgba(255,255,255,0.1)' : 'transparent',
            color: regionType === r ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
          }}>{r}</button>
        ))}
      </div>

      <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: '8px' }}>Symptoms</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {SYMPTOMS.map(s => (
          <button key={s} onClick={() => setSymptom(s === symptom ? null : s)} style={{
            padding: '5px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: '300',
            fontFamily: "'DM Sans', sans-serif",
            border: `1px solid ${symptom === s ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.07)'}`,
            background: symptom === s ? 'rgba(255,255,255,0.1)' : 'transparent',
            color: symptom === s ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
          }}>{s}</button>
        ))}
      </div>
      <textarea value={customText} onChange={e => setCustomText(e.target.value)}
        placeholder="e.g. sharp pain when I twist..."
        style={{
          width: '100%', height: '52px', background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px',
          color: 'rgba(255,255,255,0.7)', padding: '8px 10px', fontSize: '12px',
          fontWeight: '300', fontFamily: "'DM Sans', sans-serif",
          resize: 'none', boxSizing: 'border-box', marginBottom: '12px', outline: 'none',
        }}
      />

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: '8px' }}>
          Skin Scan <span style={{ textTransform: 'none', letterSpacing: 0, color: 'rgba(255,255,255,0.18)' }}>· optional</span>
        </div>
        {scanResult ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '300', color: 'rgba(255,255,255,0.8)', marginBottom: '2px' }}>{scanResult.condition}</div>
                <div style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.35)' }}>{Math.round(scanResult.confidence * 100)}% confidence</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  padding: '3px 9px', borderRadius: '999px', fontSize: '10px', fontWeight: '400',
                  letterSpacing: '1px', textTransform: 'uppercase',
                  background: `${SEV_COLOR[scanResult.severity]}22`,
                  border: `1px solid ${SEV_COLOR[scanResult.severity]}44`,
                  color: SEV_COLOR[scanResult.severity],
                }}>{scanResult.severity}</span>
                <button onClick={onClearScan} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '14px', padding: '2px', lineHeight: 1 }}>✕</button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={onScanSkin} style={{
            width: '100%', padding: '9px', background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
            color: 'rgba(255,255,255,0.45)', fontSize: '11px', fontWeight: '400',
            letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer',
            fontFamily: "'DM Sans', sans-serif",
          }}>◎ Scan skin</button>
        )}
      </div>

      <button onClick={onGetRemedies} disabled={(!symptom && !customText) || loading}
        style={{
          width: '100%', padding: '11px', background: 'rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px', fontSize: '11px', fontWeight: '400',
          fontFamily: "'DM Sans', sans-serif", letterSpacing: '2.5px',
          textTransform: 'uppercase', cursor: 'pointer',
          opacity: (!symptom && !customText) || loading ? 0.35 : 1,
        }}>
        {loading ? 'Finding remedies...' : 'Get remedies'}
      </button>

      {(loading || remedies) && (
        <div style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px' }}>
          <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: '10px' }}>Remedies</div>
          {loading
            ? <div style={{ fontSize: '12px', fontWeight: '300', color: 'rgba(255,255,255,0.35)', lineHeight: 1.7, animation: 'blink 1.6s ease-in-out infinite' }}>Loading...</div>
            : <div style={{ fontSize: '12px', fontWeight: '300', color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{remedies}</div>
          }
        </div>
      )}
    </div>
  )
}

// ─── Skin Scan Modal ──────────────────────────────────────────────────────────
function SkinScanModal({ bodyRegion, onClose, onResult }) {
  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const [phase, setPhase]             = useState('camera') // 'camera' | 'preview' | 'loading' | 'result'
  const [capturedB64, setCapturedB64] = useState(null)
  const [result, setResult]           = useState(null)
  const [error, setError]             = useState(null)

  useEffect(() => {
    let active = true
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1920 } },
    }).then(stream => {
      if (!active) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    }).catch(() => setError('Camera access denied. Please allow camera access and try again.'))
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  function capture() {
    const video = videoRef.current
    if (!video) return
    const size = Math.min(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1024
    canvas.getContext('2d').drawImage(
      video,
      (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size,
      0, 0, 1024, 1024
    )
    streamRef.current?.getTracks().forEach(t => t.stop())
    setCapturedB64(canvas.toDataURL('image/jpeg', 0.92).split(',')[1])
    setPhase('preview')
  }

  async function analyze() {
    setPhase('loading')
    try {
      const base = import.meta.env.VITE_ML_BACKEND_URL || 'http://localhost:8000'
      const res = await fetch(`${base}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: capturedB64, body_region: bodyRegion, zoom_level: 1.0 }),
      })
      if (!res.ok) throw new Error()
      setResult(await res.json())
      setPhase('result')
    } catch {
      setError('Could not reach the skin analysis server. Make sure the ML backend is running on port 8000.')
      setPhase('preview')
    }
  }

  function retake() {
    setCapturedB64(null); setResult(null); setError(null); setPhase('camera')
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1920 } },
    }).then(stream => {
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    }).catch(() => setError('Camera access denied.'))
  }

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '440px', background: '#0a0a0a',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '24px', overflow: 'hidden',
        boxShadow: '0 40px 100px rgba(0,0,0,0.9)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '400', color: 'white', letterSpacing: '-0.3px' }}>Skin Scan</div>
            <div style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>{bodyRegion}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(255,255,255,0.3)', borderRadius: '50%', width: '32px', height: '32px',
            cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px 24px' }}>
          {/* Viewfinder / Preview */}
          {(phase === 'camera' || phase === 'preview') && (
            <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', background: '#111', marginBottom: '16px', aspectRatio: '1/1' }}>
              {phase === 'camera'
                ? <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <img src={`data:image/jpeg;base64,${capturedB64}`} alt="Captured" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              }
              {phase === 'camera' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ width: '68%', height: '68%', border: '1.5px solid rgba(255,255,255,0.45)', borderRadius: '50%' }} />
                  <div style={{ position: 'absolute', bottom: '14px', fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.5)', letterSpacing: '1px' }}>
                    Center lesion within circle
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {phase === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
              <div style={{ fontSize: '11px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', animation: 'blink 1.6s ease-in-out infinite' }}>Analyzing...</div>
            </div>
          )}

          {/* Results */}
          {phase === 'result' && result && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: '5px' }}>Detected condition</div>
                  <div style={{ fontSize: '20px', fontWeight: '300', color: 'white', letterSpacing: '-0.4px' }}>{result.condition}</div>
                </div>
                <span style={{
                  marginTop: '18px', padding: '4px 12px', borderRadius: '999px',
                  fontSize: '10px', fontWeight: '400', letterSpacing: '1.5px', textTransform: 'uppercase',
                  background: `${SEV_COLOR[result.severity]}22`, border: `1px solid ${SEV_COLOR[result.severity]}55`,
                  color: SEV_COLOR[result.severity], flexShrink: 0,
                }}>{result.severity}</span>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)' }}>Confidence</span>
                  <span style={{ fontSize: '12px', fontWeight: '300', color: 'rgba(255,255,255,0.6)' }}>{Math.round(result.confidence * 100)}%</span>
                </div>
                <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px' }}>
                  <div style={{ height: '100%', borderRadius: '4px', width: `${result.confidence * 100}%`, background: SEV_COLOR[result.severity] }} />
                </div>
              </div>

              <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: '10px' }}>Differential</div>
              {result.top3.map((t, i) => (
                <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <span style={{ fontSize: '13px', fontWeight: '300', color: i === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)' }}>{t.label}</span>
                  <span style={{ fontSize: '12px', fontWeight: '300', color: i === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)' }}>{Math.round(t.prob * 100)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ marginBottom: '14px', padding: '12px 14px', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)', borderRadius: '10px', fontSize: '12px', fontWeight: '300', color: '#e07070', lineHeight: 1.6 }}>
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {phase === 'camera' && !error && (
              <button onClick={capture} style={{ flex: 1, padding: '13px', background: 'white', color: '#000', border: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: '600', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' }}>
                Capture
              </button>
            )}
            {phase === 'camera' && error && (
              <button onClick={onClose} style={{ flex: 1, padding: '13px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' }}>
                Close
              </button>
            )}
            {phase === 'preview' && (<>
              <button onClick={retake} style={{ flex: 1, padding: '13px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' }}>Retake</button>
              <button onClick={analyze} style={{ flex: 1, padding: '13px', background: 'white', color: '#000', border: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: '600', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' }}>Analyze</button>
            </>)}
            {phase === 'result' && (<>
              <button onClick={retake} style={{ flex: 1, padding: '13px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' }}>Retake</button>
              <button onClick={() => { onResult(result); onClose() }} style={{ flex: 1, padding: '13px', background: 'white', color: '#000', border: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: '600', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer' }}>Use result</button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Global styles ────────────────────────────────────────────────────────────
const GLOBAL_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,200;9..40,300;9..40,400;9..40,500&family=Inter:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { width: 100%; height: 100dvh; overflow: hidden; background: #000; }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes blink {
    0%, 100% { opacity: 0.2; }
    50% { opacity: 0.95; }
  }
  @keyframes bob {
    0%, 100% { transform: translateX(0); opacity: 0.55; }
    50% { transform: translateX(-5px); opacity: 0.85; }
  }
  select option { color: #000; background: #fff; }
  input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 3px; background: rgba(255,255,255,0.1); border-radius: 3px; outline: none; cursor: pointer; display: block; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 1px 6px rgba(0,0,0,0.5); }
  input[type=range]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: white; cursor: pointer; border: none; box-shadow: 0 1px 6px rgba(0,0,0,0.5); }
  @keyframes excitedBounce {
    0%, 65%, 100% { transform: translateY(0) rotate(0deg); }
    68%  { transform: translateY(-7px) rotate(-6deg); }
    71%  { transform: translateY(2px)  rotate(4deg);  }
    74%  { transform: translateY(-6px) rotate(-5deg); }
    77%  { transform: translateY(2px)  rotate(5deg);  }
    80%  { transform: translateY(-4px) rotate(-3deg); }
    83%  { transform: translateY(1px)  rotate(2deg);  }
    86%  { transform: translateY(-2px) rotate(-1deg); }
    89%  { transform: translateY(0)    rotate(0deg);  }
  }
`

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [showLanding, setShowLanding]   = useState(true)
  const [fading, setFading]             = useState(false)
  const [clickPoint, setClickPoint]     = useState(null)
  const [clickDir, setClickDir]         = useState(null)
  const [region, setRegion]             = useState(null)
  const [regionType, setRegionType]     = useState(null)
  const [symptom, setSymptom]           = useState(null)
  const [customText, setCustomText]     = useState('')
  const [remedies, setRemedies]         = useState(null)
  const [loading, setLoading]           = useState(false)
  const [zoomed, setZoomed]             = useState(false)
  const [cameraModified, setCameraModified] = useState(false)
  const [hoverRegion, setHoverRegion]   = useState(null)
  const [tooltipPos, setTooltipPos]     = useState({ x: 0, y: 0 })
  const [showLogin, setShowLogin]       = useState(false)
  const [loginEmail, setLoginEmail]     = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [authMode, setAuthMode]         = useState('login')
  const [authError, setAuthError]       = useState('')
  const [authWorking, setAuthWorking]   = useState(false)
  const [user, setUser]                 = useState(null)
  const [authLoading, setAuthLoading]   = useState(true)
  const [showHistory, setShowHistory]   = useState(false)
  const [historyHintSeen, setHistoryHintSeen] = useState(false)
  const [history, setHistory]           = useState([])
  const [expandedHistoryId, setExpandedHistoryId]       = useState(null)
  const [hoveredHistoryRegion, setHoveredHistoryRegion] = useState(null)
  const [profileOpen, setProfileOpen]     = useState(false)
  const [profileSaved, setProfileSaved]   = useState(false)
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileDraft, setProfileDraft]   = useState({
    dob: '', sex: '', height: '', weight: '',
    conditions: '', medications: '', allergies: '',
    activityLevel: '', smoking: '', familyHistory: '',
  })
  const [profile, setProfile] = useState({
    dob: '', sex: '', height: '', weight: '',
    conditions: '', medications: '', allergies: '',
    activityLevel: '', smoking: '', familyHistory: '',
  })
  const [showSkinScan, setShowSkinScan] = useState(false)
  const [scanResult, setScanResult]     = useState(null)
  const [isMobile, setIsMobile]         = useState(() => window.innerWidth < 768)
  const [draftRating, setDraftRating]   = useState(5)
  const [jokeVisible, setJokeVisible] = useState(false)
  const [jokeFading, setJokeFading]   = useState(false)
  const [currentJoke, setCurrentJoke] = useState('')
  const jokeTimerRef = useRef(null)
  const orbitRef    = useRef()
  const stopAnimRef = useRef(false)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ─── Firebase auth listener ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser)
        const { profile: savedProfile, history: savedHistory } = await loadUserData(firebaseUser.uid)
        setProfile(savedProfile)
        setProfileDraft(savedProfile)
        setHistory(savedHistory)
        if (Object.values(savedProfile).some(v => v)) setProfileSaved(true)
      } else {
        setUser(null)
        setHistory([])
        setProfile({ dob: '', sex: '', height: '', weight: '', conditions: '', medications: '', allergies: '', activityLevel: '', smoking: '', familyHistory: '' })
      }
      setAuthLoading(false)
    })
    return () => unsub()
  }, [])

  const dismissLanding = () => {
    if (!showLanding || fading) return
    setFading(true)
    setTimeout(() => setShowLanding(false), 800)
  }

  const handlePartClick = (point, regionName, dir) => {
    setClickPoint(point); setClickDir(dir || null); setRegion(regionName); setZoomed(true)
    setSymptom(null); setCustomText(''); setRemedies(null)
    setHoverRegion(null); setRegionType(null)
  }

  const addFollowUp = (entryId, rating) => {
    setHistory(prev => {
      const updated = prev.map(e =>
        e.id === entryId
          ? { ...e, followUps: [...(e.followUps || []), { timestamp: Date.now(), rating }] }
          : e
      )
      if (user) saveHistory(user.uid, updated)
      return updated
    })
  }

  const deleteFollowUp = (entryId, index) => {
    setHistory(prev => {
      const updated = prev.map(e =>
        e.id === entryId
          ? { ...e, followUps: (e.followUps || []).filter((_, i) => i !== index) }
          : e
      )
      if (user) saveHistory(user.uid, updated)
      return updated
    })
  }

  const handleClear = () => {
    stopAnimRef.current = false
    setClickPoint(null); setRegion(null); setZoomed(false)
    setSymptom(null); setCustomText(''); setRemedies(null)
    setRegionType(null); setCameraModified(false)
    setScanResult(null)
    setResetKey(k => k + 1)
  }

  const fadeJoke = () => {
    setJokeFading(true)
    setTimeout(() => { setJokeVisible(false); setJokeFading(false) }, 450)
  }

  const showNewJoke = (e) => {
    e.stopPropagation()
    if (jokeTimerRef.current) clearTimeout(jokeTimerRef.current)
    const joke = JOKES[Math.floor(Math.random() * JOKES.length)]
    setCurrentJoke(joke)
    setJokeFading(false)
    setJokeVisible(true)
    jokeTimerRef.current = setTimeout(fadeJoke, 9000)
  }

  useEffect(() => {
    if (!jokeVisible) return
    const handler = () => fadeJoke()
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [jokeVisible])

  const dismissPopup = () => {
    setRegion(null)
    setSymptom(null); setCustomText(''); setRemedies(null); setRegionType(null)
  }

  const getRemedies = async () => {
    setLoading(true); setRemedies(null)

    const parts = []
    if (region) parts.push(`affected area: ${region}${regionType ? ` (${regionType})` : ''}`)
    if (symptom) parts.push(`symptom: ${symptom}`)
    if (customText) parts.push(`additional details: ${customText}`)

    const ctx = [
      profile.dob           && `Date of birth: ${profile.dob}`,
      profile.sex           && `Sex: ${profile.sex}`,
      profile.height        && `Height: ${profile.height}`,
      profile.weight        && `Weight: ${profile.weight}`,
      profile.activityLevel && `Activity level: ${profile.activityLevel}`,
      profile.smoking       && `Smoking: ${profile.smoking}`,
      profile.conditions    && `Pre-existing conditions: ${profile.conditions}`,
      profile.medications   && `Current medications: ${profile.medications}`,
      profile.allergies     && `Allergies: ${profile.allergies}`,
      profile.familyHistory && `Family history: ${profile.familyHistory}`,
    ].filter(Boolean).join('. ')

    const scanCtx = scanResult
      ? ` Camera skin scan detected: ${scanResult.condition} (${Math.round(scanResult.confidence * 100)}% confidence, ${scanResult.severity} severity).`
      : ''
    const prompt = `I have the following issue — ${parts.join(', ')}.${ctx ? ` Patient context: ${ctx}.` : ''}${scanCtx} Give me the best practical at-home remedies. Be specific and concise. Format as a numbered list.`

    const fallback = [
      `1. Rest the affected area and avoid movements that aggravate it.`,
      `2. Apply ice for the first 48 hours (15–20 min on, 15–20 min off) to limit swelling. Switch to heat after 48 hours to promote circulation.`,
      `3. Keep the area elevated when possible to reduce inflammation.`,
      `4. Take over-the-counter pain relief (ibuprofen or acetaminophen) as directed on the label if appropriate for you.`,
      `5. Stay gently mobile — complete rest can slow recovery. Light stretching and short walks help maintain blood flow.`,
      `6. Stay hydrated and prioritise sleep, both of which significantly accelerate tissue repair.`,
      `7. If symptoms worsen, don't improve within 2 weeks, or are accompanied by fever, severe swelling, or numbness — see a healthcare professional.`,
    ].join('\n')

    let remedyText
    try {
      const res = await fetch('/api/remedies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      remedyText = data.text
    } catch {
      remedyText = fallback
    }
    setRemedies(remedyText); setLoading(false)

    setHistory(prev => {
      const updated = [{
        id: Date.now(), region, regionType, symptom, customText,
        remedies: remedyText, followUps: [],
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      }, ...prev]
      if (user) saveHistory(user.uid, updated)
      return updated
    })
  }

  return (
    <>
      <style>{GLOBAL_STYLE}</style>
      <div style={{
        width: '100%', height: '100dvh', background: '#000',
        position: 'relative', overflow: 'hidden',
        fontFamily: "'DM Sans', sans-serif"
      }}>

        {/* Content area — shifts left when history opens */}
        <div style={{
          position: 'absolute', inset: 0,
          transform: !isMobile && showHistory ? 'translateX(-180px)' : 'translateX(0)',
          transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <Canvas
            camera={{ position: [0.45, 0.91, 0.22], fov: 24 }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            dpr={window.devicePixelRatio}
            gl={{ antialias: true }}
            onPointerMissed={!showLanding ? handleClear : undefined}
            onCreated={({ gl }) => {
              gl.domElement.addEventListener('webglcontextlost', e => e.preventDefault(), false)
            }}
          >
            <color attach="background" args={['#000000']} />
            <ambientLight intensity={0.55} />
            <directionalLight position={[3, 5, 3]} intensity={1.4} />
            <directionalLight position={[-2, -2, -2]} intensity={0.2} />
            <directionalLight position={[0, -4, 2]} intensity={0.3} />

            <CameraController target={clickPoint} zoom={zoomed} approachDir={clickDir} orbitRef={orbitRef} landingMode={showLanding} stopRef={stopAnimRef} resetKey={resetKey} />

            <Suspense fallback={null}>
              <BodyModel
                onPartClick={handlePartClick}
                onHover={(r, x, y) => { setHoverRegion(r); setTooltipPos({ x, y }) }}
                onHoverEnd={() => setHoverRegion(null)}
                interactive={!showLanding}
                selectedRegion={region}
                highlightName={hoveredHistoryRegion}
              />
            </Suspense>

            <OrbitControls
              ref={orbitRef} enabled={!showLanding}
              enablePan={false} enableDamping dampingFactor={0.08}
              zoomSpeed={0.4}
              minDistance={1.5} maxDistance={12}
              onStart={() => { stopAnimRef.current = true; setCameraModified(true); if (region) dismissPopup() }}
            />
          </Canvas>

          {/* Landing */}
          {showLanding && (
            <div
              onClick={dismissLanding}
              style={{
                position: 'absolute', inset: 0, cursor: 'pointer', zIndex: 100,
                opacity: fading ? 0 : 1, transition: 'opacity 0.8s ease',
                pointerEvents: fading ? 'none' : 'all',
                display: 'flex', alignItems: 'center',
              }}
            >
              <button
                onClick={e => { e.stopPropagation(); setShowLogin(true) }}
                style={{
                  position: 'absolute', top: '24px', right: '32px',
                  padding: '13px 34px', background: 'white', color: '#000',
                  border: 'none', borderRadius: '999px', fontSize: '15px',
                  fontWeight: '800', fontFamily: "'DM Sans', sans-serif",
                  letterSpacing: '0.5px', cursor: 'pointer', zIndex: 3,
                }}
              >Log in</button>
              <div style={{
                position: 'relative', zIndex: 2,
                paddingLeft: isMobile ? '28px' : '16vw',
                paddingRight: isMobile ? '28px' : 0,
                display: 'flex', flexDirection: 'column',
                alignItems: isMobile ? 'center' : 'flex-start',
                textAlign: isMobile ? 'center' : 'left',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: isMobile ? '14px' : '20px', marginBottom: '12px',
                  animation: 'fadeUp 0.7s ease both', animationDelay: '0.1s',
                }}>
                  <img src="/Logo.png" alt="Dr. Pocket" style={{ height: isMobile ? '54px' : '88px', width: isMobile ? '54px' : '88px', objectFit: 'contain', flexShrink: 0 }} />
                  <span style={{ fontSize: isMobile ? '54px' : '104px', fontWeight: '300', color: '#fff', letterSpacing: '-3px', lineHeight: 1, whiteSpace: 'nowrap', textShadow: '0 2px 40px rgba(0,0,0,0.8)' }}>
                    Dr. Pocket
                  </span>
                </div>
                <div style={{ paddingLeft: isMobile ? '0' : '108px', marginBottom: '36px', animation: 'fadeUp 0.7s ease both', animationDelay: '0.28s' }}>
                  <span style={{ fontSize: isMobile ? '16px' : '20.5px', fontWeight: '300', color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1px', whiteSpace: isMobile ? 'normal' : 'nowrap', textShadow: '0 2px 20px rgba(0,0,0,0.9)' }}>
                    Pinpoint your pain. Get remedies instantly.
                  </span>
                </div>
                <div style={{ paddingLeft: isMobile ? '0' : '108px', display: 'flex', alignItems: 'center', gap: '10px', animation: 'fadeUp 0.7s ease both', animationDelay: '0.44s' }}>
                  <span style={{ fontSize: '14px', fontWeight: '400', color: 'rgba(255,255,255,0.9)', letterSpacing: '3.5px', textTransform: 'uppercase', animation: 'blink 2.8s ease-in-out infinite', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>
                    {isMobile ? 'Tap anywhere to begin' : 'Click anywhere to begin'}
                  </span>
                  {!isMobile && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.25, flexShrink: 0 }}>
                      <path d="M2 7h10M8 3l4 4-4 4" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* App UI */}
          {!showLanding && (
            <>
              {hoverRegion && !clickPoint && !isMobile && (
                <div style={{
                  position: 'fixed', left: tooltipPos.x + 14, top: tooltipPos.y - 38,
                  zIndex: 30, background: '#0a0a0a',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
                  padding: '6px 13px', color: 'rgba(255,255,255,0.75)',
                  fontSize: '12px', fontWeight: '300', letterSpacing: '0.3px',
                  pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>
                  {hoverRegion}
                </div>
              )}

              {clickPoint && region && (
                <AnnotationPanel
                  region={region}
                  regionType={regionType} setRegionType={setRegionType}
                  symptom={symptom} setSymptom={setSymptom}
                  customText={customText} setCustomText={setCustomText}
                  onGetRemedies={getRemedies} loading={loading}
                  onClear={handleClear} remedies={remedies}
                  historyOpen={showHistory}
                  onScanSkin={() => setShowSkinScan(true)}
                  scanResult={scanResult}
                  onClearScan={() => setScanResult(null)}
                  isMobile={isMobile}
                />
              )}

              {!clickPoint && !hoverRegion && (
                <div style={{
                  position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                  fontSize: '10px', fontWeight: '400', letterSpacing: '2.5px',
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)',
                  zIndex: 10, pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>
                  Hover · Click · Drag · Scroll
                </div>
              )}
            <div style={{
              position: 'absolute', bottom: '12px', right: '20px',
              fontSize: '10px', fontWeight: '300', color: 'rgba(255,255,255,0.15)',
              zIndex: 10, pointerEvents: 'none', whiteSpace: 'nowrap',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              © 2026 Jason Chan, Soren Caron, Daniel Wang, Samuel Zhu. All rights reserved.
            </div>
            </>
          )}

          {/* Login modal */}
          {showLogin && (
            <div onClick={() => setShowLogin(false)} style={{
              position: 'absolute', inset: 0, zIndex: 500,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div onClick={e => e.stopPropagation()} style={{
                width: isMobile ? 'calc(100% - 32px)' : '400px', background: '#0a0a0a',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '24px', padding: isMobile ? '28px 24px' : '40px',
                fontFamily: "'DM Sans', sans-serif",
                boxShadow: '0 40px 100px rgba(0,0,0,0.9)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                  <div>
                    <div style={{ fontSize: '22px', fontWeight: '300', color: 'white', letterSpacing: '-0.5px' }}>
                      {authMode === 'login' ? 'Welcome back' : 'Create account'}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: '300', color: 'rgba(255,255,255,0.35)', marginTop: '4px' }}>
                      {authMode === 'login' ? 'Sign in to your account' : 'Join Dr. Pocket'}
                    </div>
                  </div>
                  <button onClick={() => setShowLogin(false)} style={{
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)',
                    color: 'rgba(255,255,255,0.3)', borderRadius: '50%', width: '32px', height: '32px',
                    cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>✕</button>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '400', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', display: 'block', marginBottom: '8px' }}>Email</label>
                  <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@example.com"
                    style={{ width: '100%', padding: '13px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', color: 'white', fontSize: '14px', fontWeight: '300', fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ marginBottom: '28px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '400', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', display: 'block', marginBottom: '8px' }}>Password</label>
                  <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••"
                    style={{ width: '100%', padding: '13px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', color: 'white', fontSize: '14px', fontWeight: '300', fontFamily: "'DM Sans', sans-serif", outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  onClick={async () => {
                    setAuthError(''); setAuthWorking(true)
                    try {
                      if (authMode === 'login') await loginUser(loginEmail, loginPassword)
                      else await registerUser(loginEmail, loginPassword)
                      setShowLogin(false); setLoginEmail(''); setLoginPassword('')
                    } catch (e) {
                      setAuthError(e.message.replace('Firebase: ', '').replace(/\s*\(.*\)/, ''))
                    }
                    setAuthWorking(false)
                  }}
                  style={{ width: '100%', padding: '14px', background: 'white', color: '#000', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer', opacity: authWorking ? 0.6 : 1 }}
                >
                  {authWorking ? 'Please wait...' : authMode === 'login' ? 'Log in' : 'Create account'}
                </button>
                {authError && (
                  <div style={{ marginTop: '12px', fontSize: '12px', color: '#ff6b6b', textAlign: 'center', fontWeight: '300' }}>{authError}</div>
                )}
                <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', fontWeight: '300', color: 'rgba(255,255,255,0.25)' }}>
                  {authMode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                  <span onClick={() => { setAuthMode(m => m === 'login' ? 'signup' : 'login'); setAuthError('') }}
                    style={{ color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}>
                    {authMode === 'login' ? 'Sign up' : 'Log in'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>{/* end content area */}

        {/* Navbar */}
        {!showLanding && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 300,
            padding: '16px 28px', display: 'flex', alignItems: 'center', gap: '12px',
            pointerEvents: 'none',
          }}>
            <img src="/Logo.png" alt="" style={{ height: '26px', width: '26px', objectFit: 'contain', pointerEvents: 'all' }} />
            <span style={{ fontSize: '17px', fontWeight: '400', color: 'white', letterSpacing: '-0.3px' }}>Dr. Pocket</span>
            {!isMobile && <>
              <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.12)', margin: '0 4px' }} />
              <span style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)' }}>
                Hover to explore · Click to select
              </span>
            </>}
            <div style={{ marginLeft: 'auto', pointerEvents: 'all', display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isMobile && (
                <button onClick={() => { setShowHistory(h => !h); setHistoryHintSeen(true) }} style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '999px', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit' }}>
                  History
                </button>
              )}
              {user
                ? <>
                    {!isMobile && <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: '300' }}>{user.email}</span>}
                    <button onClick={logoutUser} style={{ padding: '5px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '999px', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit' }}>Log out</button>
                  </>
                : <button onClick={() => setShowLogin(true)} style={{ padding: '7px 18px', background: 'white', border: 'none', borderRadius: '999px', color: '#000', cursor: 'pointer', fontSize: '12px', fontWeight: '700', fontFamily: 'inherit' }}>Log in</button>
              }
            </div>
          </div>
        )}

        {/* Reset button */}
        {!showLanding && (clickPoint || cameraModified) && (
          <div style={{
            position: 'absolute', bottom: '72px', left: '50%',
            transform: !isMobile && showHistory ? 'translateX(calc(-50% - 180px))' : 'translateX(-50%)',
            transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
            zIndex: 300,
          }}>
            <button onClick={handleClear} style={{
              padding: '10px 28px', background: 'white', border: 'none', borderRadius: '999px',
              color: '#111', cursor: 'pointer', fontSize: '13px', fontWeight: '500',
              fontFamily: "'DM Sans', sans-serif", boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}>← Reset</button>
          </div>
        )}

        {/* Edge tab */}
        {!showLanding && !isMobile && (
          <div style={{
            position: 'absolute', top: '50%', right: '360px',
            transform: showHistory ? 'translateY(-50%)' : 'translate(360px, -50%)',
            transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
            zIndex: 310,
          }}>
            {!historyHintSeen && !showHistory && (
              <div style={{
                position: 'absolute', right: '30px', top: 0, bottom: 0,
                display: 'flex', alignItems: 'center', pointerEvents: 'none',
              }}>
                <span style={{
                  display: 'block', whiteSpace: 'nowrap', fontSize: '11px', fontWeight: '500',
                  letterSpacing: '1.8px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
                  fontFamily: "'Inter', sans-serif", animation: 'bob 2s ease-in-out infinite',
                }}>Click to View Medical History</span>
              </div>
            )}
            <button onClick={() => { setShowHistory(h => !h); setHistoryHintSeen(true) }} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '72px',
              background: '#111', border: '1px solid rgba(255,255,255,0.1)',
              borderRight: 'none', borderRadius: '6px 0 0 6px',
              cursor: 'pointer', padding: 0,
            }}>
              <svg width="14" height="24" viewBox="0 0 14 24" fill="none">
                {showHistory
                  ? <path d="M3 1l8 11-8 11" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  : <path d="M11 1L3 12l8 11" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                }
              </svg>
            </button>
          </div>
        )}

        {/* Joke button — bottom left */}
        {!showLanding && (
          <div style={{ position: 'absolute', bottom: '28px', left: '28px', zIndex: 300 }}>
            {jokeVisible && (
              <div style={{
                position: 'absolute', bottom: '72px', left: 0,
                width: '260px', background: '#111', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '16px', padding: '18px 20px',
                fontSize: '13px', fontWeight: '300', color: 'rgba(255,255,255,0.75)',
                lineHeight: '1.7', fontFamily: "'DM Sans', sans-serif",
                boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
                opacity: jokeFading ? 0 : 1, transition: 'opacity 0.45s ease',
                pointerEvents: 'none',
              }}>
                {currentJoke}
                <div style={{ position: 'absolute', bottom: '-13px', left: '15px', width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderTop: '13px solid rgba(255,255,255,0.1)' }} />
                <div style={{ position: 'absolute', bottom: '-11px', left: '16px', width: 0, height: 0, borderLeft: '9px solid transparent', borderRight: '9px solid transparent', borderTop: '11px solid #111' }} />
              </div>
            )}
            <button onClick={showNewJoke} style={{
              width: '42px', height: '42px', borderRadius: '50%',
              background: 'white', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              animation: 'excitedBounce 4s ease-in-out infinite',
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="7" cy="8" r="1.2" fill="#111"/>
                <circle cx="13" cy="8" r="1.2" fill="#111"/>
                <path d="M6.5 12.5 Q10 15.5 13.5 12.5" stroke="#111" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
              </svg>
            </button>
          </div>
        )}

        {/* Skin scan modal */}
        {showSkinScan && region && (
          <SkinScanModal
            bodyRegion={region}
            onClose={() => setShowSkinScan(false)}
            onResult={result => { setScanResult(result); setShowSkinScan(false) }}
          />
        )}

        {/* Medical history sidebar */}
        {!showLanding && (
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: isMobile ? '100%' : '360px',
            transform: showHistory ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
            background: '#0a0a0a', borderLeft: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column',
            fontFamily: "'DM Sans', sans-serif",
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '16px', fontWeight: '400', color: 'white', letterSpacing: '-0.3px' }}>Medical History</div>
              {isMobile && (
                <button onClick={() => setShowHistory(false)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.3)', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              )}
              {history.length > 0 && (
                <div style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                  {history.length} entr{history.length === 1 ? 'y' : 'ies'}
                </div>
              )}
            </div>

            {/* Health Profile */}
            {(() => {
              const profileHasData = Object.values(profile).some(v => v)
              const showForm = !profileSaved || profileEditing
              return (
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <button onClick={() => setProfileOpen(o => !o)} style={{
                    width: '100%', padding: '14px 24px', background: 'transparent', border: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', color: 'rgba(255,255,255,0.55)', fontFamily: "'DM Sans', sans-serif",
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '400', letterSpacing: '1.8px', textTransform: 'uppercase' }}>Health Profile</span>
                      {!profileHasData && (
                        <span style={{ fontSize: '10px', fontWeight: '300', color: 'rgba(255,255,255,0.25)', letterSpacing: '0', textTransform: 'none' }}>optional · for more accurate results</span>
                      )}
                    </div>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                      <path d="M2 4l4 4 4-4" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {profileOpen && (
                    <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {showForm ? (
                        <>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={labelStyle}>Date of Birth</div>
                              <input type="date" value={profileDraft.dob} onChange={e => setProfileDraft(p => ({...p, dob: e.target.value}))} style={inputStyle} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={labelStyle}>Sex</div>
                              <select value={profileDraft.sex} onChange={e => setProfileDraft(p => ({...p, sex: e.target.value}))} style={inputStyle}>
                                <option value="">—</option>
                                <option>Male</option><option>Female</option><option>Other</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {[['height',"e.g. 5'10\""],['weight','e.g. 160 lbs']].map(([key, ph]) => (
                              <div key={key} style={{ flex: 1 }}>
                                <div style={labelStyle}>{key.charAt(0).toUpperCase()+key.slice(1)}</div>
                                <input placeholder={ph} value={profileDraft[key]} onChange={e => setProfileDraft(p => ({...p, [key]: e.target.value}))} style={inputStyle} />
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={labelStyle}>Activity Level</div>
                              <select value={profileDraft.activityLevel} onChange={e => setProfileDraft(p => ({...p, activityLevel: e.target.value}))} style={inputStyle}>
                                <option value="">—</option>
                                <option>Sedentary</option><option>Lightly Active</option>
                                <option>Moderately Active</option><option>Very Active</option>
                              </select>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={labelStyle}>Smoking</div>
                              <select value={profileDraft.smoking} onChange={e => setProfileDraft(p => ({...p, smoking: e.target.value}))} style={inputStyle}>
                                <option value="">—</option>
                                <option>Non-smoker</option><option>Former smoker</option><option>Current smoker</option>
                              </select>
                            </div>
                          </div>
                          {[
                            ['conditions','Pre-existing Conditions','e.g. diabetes, hypertension…'],
                            ['medications','Current Medications','e.g. metformin, ibuprofen…'],
                            ['allergies','Allergies','e.g. penicillin, peanuts, latex…'],
                            ['familyHistory','Family History','e.g. heart disease, cancer…'],
                          ].map(([key, label, ph]) => (
                            <div key={key}>
                              <div style={labelStyle}>{label}</div>
                              <textarea placeholder={ph} value={profileDraft[key]} onChange={e => setProfileDraft(p => ({...p, [key]: e.target.value}))}
                                style={{...inputStyle, resize: 'none', height: '52px', lineHeight: '1.5'}} />
                            </div>
                          ))}
                          <button onClick={() => {
                            const hasAny = Object.values(profileDraft).some(v => v)
                            if (hasAny) {
                              setProfile({...profileDraft})
                              setProfileSaved(true)
                              if (user) saveProfile(user.uid, profileDraft)
                            }
                            setProfileEditing(false)
                          }} style={{
                            width: '100%', padding: '10px', marginTop: '4px',
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '10px', color: 'white', cursor: 'pointer',
                            fontSize: '12px', fontWeight: '500', fontFamily: "'DM Sans', sans-serif",
                          }}>Save Profile</button>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[
                              ['Date of Birth', profile.dob], ['Sex', profile.sex],
                              ['Height', profile.height], ['Weight', profile.weight],
                              ['Activity Level', profile.activityLevel], ['Smoking', profile.smoking],
                              ['Pre-existing Conditions', profile.conditions],
                              ['Current Medications', profile.medications],
                              ['Allergies', profile.allergies], ['Family History', profile.familyHistory],
                            ].filter(([, v]) => v).map(([label, val]) => (
                              <div key={label}>
                                <div style={labelStyle}>{label}</div>
                                <div style={{ fontSize: '12px', fontWeight: '300', color: 'rgba(255,255,255,0.6)', lineHeight: '1.5' }}>{val}</div>
                              </div>
                            ))}
                          </div>
                          <button onClick={() => { setProfileDraft({...profile}); setProfileEditing(true) }} style={{
                            width: '100%', padding: '10px', marginTop: '4px',
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '10px', color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
                            fontSize: '12px', fontFamily: "'DM Sans', sans-serif",
                          }}>Edit Profile</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* History entries */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {/* Pattern insights */}
              {(() => {
                const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000
                const counts = {}
                history.filter(e => e.id > thirtyDaysAgo).forEach(e => {
                  counts[e.region] = (counts[e.region] || 0) + 1
                })
                const insights = Object.entries(counts).filter(([, n]) => n >= 3)
                if (!insights.length) return null
                return (
                  <div style={{ marginBottom: '16px', padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px' }}>
                    <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '8px' }}>Patterns · Last 30 days</div>
                    {insights.map(([region, count]) => (
                      <div key={region} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                        <span style={{ fontSize: '13px', fontWeight: '300', color: 'rgba(255,255,255,0.65)' }}>{region}</span>
                        <span style={{ fontSize: '11px', fontWeight: '400', color: '#f39c12', padding: '2px 8px', borderRadius: '999px', background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.2)' }}>{count}×</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {history.length === 0 ? (
                <div style={{ textAlign: 'center', marginTop: '60px', color: 'rgba(255,255,255,0.2)', fontSize: '13px', fontWeight: '300' }}>
                  Click a body part and get remedies<br />to start building your history.
                </div>
              ) : history.map(entry => {
                const isExpanded = expandedHistoryId === entry.id
                const followUps = entry.followUps || []
                const latestFollowUp = followUps[followUps.length - 1]
                const needsCheckin = !followUps.length && Date.now() - entry.id > 3 * 24 * 3600 * 1000
                return (
                  <div key={entry.id}
                    onMouseEnter={() => setHoveredHistoryRegion(entry.region)}
                    onMouseLeave={() => setHoveredHistoryRegion(null)}
                    onClick={() => { setExpandedHistoryId(isExpanded ? null : entry.id); setDraftRating(5) }}
                    style={{
                      background: 'rgba(255,255,255,0.03)', borderRadius: '14px',
                      padding: '16px', marginBottom: '12px', cursor: 'pointer',
                      border: `1px solid ${hoveredHistoryRegion === entry.region ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'}`,
                      transition: 'border-color 0.2s',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isExpanded ? '10px' : 0 }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: '400', color: 'white', letterSpacing: '-0.3px' }}>{entry.region}</div>
                        {latestFollowUp && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: ratingColor(latestFollowUp.rating), flexShrink: 0 }} />
                            <span style={{ fontSize: '10px', fontWeight: '300', color: ratingColor(latestFollowUp.rating) }}>{latestFollowUp.rating}/10 — {ratingLabel(latestFollowUp.rating)}</span>
                          </div>
                        )}
                        {!latestFollowUp && needsCheckin && (
                          <div style={{ fontSize: '10px', fontWeight: '300', color: '#f39c12', marginTop: '4px' }}>Check in?</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ fontSize: '10px', fontWeight: '300', color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap', marginTop: '2px' }}>{entry.date}</div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', marginTop: '2px' }}>{isExpanded ? '▲' : '▼'}</div>
                      </div>
                    </div>
                    {isExpanded && (
                      <>
                        {(entry.regionType || entry.symptom || entry.customText) && (
                          <div style={{ marginBottom: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {entry.regionType && <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '300', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>{entry.regionType}</span>}
                            {entry.symptom && <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '300', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.55)' }}>{entry.symptom}</span>}
                            {entry.customText && <span style={{ fontSize: '12px', fontWeight: '300', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>"{entry.customText}"</span>}
                          </div>
                        )}
                        {entry.remedies && (
                          <>
                            <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', marginBottom: '10px' }} />
                            <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '6px' }}>Remedies</div>
                            <div style={{ fontSize: '12px', fontWeight: '300', color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{entry.remedies}</div>
                          </>
                        )}

                        {/* Progress check-in */}
                        <div style={{ marginTop: '14px' }} onClick={e => e.stopPropagation()}>
                          <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', marginBottom: '12px' }} />
                          <div style={{ fontSize: '10px', fontWeight: '400', letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '10px' }}>Progress</div>

                          {/* Line graph — 2+ check-ins */}
                          {followUps.length >= 2 && (() => {
                            const W = 280, H = 88, PAD = 24
                            const times = followUps.map(f => f.timestamp)
                            const minT = Math.min(...times), maxT = Math.max(...times)
                            const xOf = t => PAD + (maxT === minT ? (W - PAD * 2) / 2 : (t - minT) / (maxT - minT) * (W - PAD * 2))
                            const yOf = r => H - PAD - (r - 1) / 9 * (H - PAD * 2)
                            const pts = followUps.map(f => `${xOf(f.timestamp)},${yOf(f.rating)}`).join(' ')
                            return (
                              <div style={{ marginBottom: '14px', borderRadius: '10px', background: 'rgba(255,255,255,0.02)', padding: '6px 2px 2px' }}>
                                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
                                  {[1, 4, 7, 10].map(r => (
                                    <line key={r} x1={PAD} y1={yOf(r)} x2={W - PAD} y2={yOf(r)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                                  ))}
                                  <text x={PAD - 5} y={yOf(10) + 3} fontSize="7" fill="rgba(255,255,255,0.2)" textAnchor="end">10</text>
                                  <text x={PAD - 5} y={yOf(1) + 3} fontSize="7" fill="rgba(255,255,255,0.2)" textAnchor="end">1</text>
                                  <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeLinejoin="round" />
                                  {followUps.map((f, i) => (
                                    <circle key={i} cx={xOf(f.timestamp)} cy={yOf(f.rating)} r="4" fill={ratingColor(f.rating)} stroke="#0a0a0a" strokeWidth="2" />
                                  ))}
                                </svg>
                              </div>
                            )
                          })()}

                          {/* Check-in list with delete */}
                          {followUps.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                              {followUps.map((fu, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: i < followUps.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: ratingColor(fu.rating), flexShrink: 0 }} />
                                  <span style={{ fontSize: '13px', fontWeight: '300', color: ratingColor(fu.rating) }}>{fu.rating}/10</span>
                                  <span style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.3)' }}>{ratingLabel(fu.rating)}</span>
                                  <span style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.18)', marginLeft: 'auto' }}>
                                    {new Date(fu.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                  <button onClick={() => deleteFollowUp(entry.id, i)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '13px', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Slider */}
                          <div style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.3)', marginBottom: '10px' }}>
                            {followUps.length === 0 ? 'How is it feeling right now?' : 'Log another check-in'}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                            <span style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.2)' }}>No pain</span>
                            <span style={{ fontSize: '22px', fontWeight: '300', color: ratingColor(draftRating), letterSpacing: '-0.5px' }}>
                              {draftRating}<span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)' }}>/10</span>
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: '300', color: 'rgba(255,255,255,0.2)' }}>Severe</span>
                          </div>
                          <input type="range" min="1" max="10" value={draftRating} onChange={e => setDraftRating(Number(e.target.value))} style={{ marginBottom: '10px' }} />
                          <button onClick={() => { addFollowUp(entry.id, draftRating); setDraftRating(5) }} style={{
                            width: '100%', padding: '9px',
                            background: `${ratingColor(draftRating)}18`,
                            border: `1px solid ${ratingColor(draftRating)}44`,
                            borderRadius: '8px', color: ratingColor(draftRating),
                            fontSize: '11px', fontWeight: '400', letterSpacing: '1.5px',
                            textTransform: 'uppercase', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
                          }}>Log {draftRating}/10 — {ratingLabel(draftRating)}</button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button style={{
                width: '100%', padding: '11px', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
                color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: '11px',
                fontWeight: '400', letterSpacing: '1.2px', textTransform: 'uppercase', fontFamily: 'inherit',
              }}>↓ Download Full Medical History</button>
              {history.length > 0 && (
                <button onClick={() => { setHistory([]); if (user) saveHistory(user.uid, []) }} style={{
                  width: '100%', padding: '10px', background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px',
                  color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '11px',
                  fontWeight: '400', letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'inherit',
                }}>Clear history</button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
