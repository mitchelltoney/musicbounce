"""
Pydantic models mirroring src/types/contracts.ts `Score` — kept in sync (LAW).
If contracts.ts changes, change this too; the analyzer must emit this exact shape.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel

BandName = Literal["sub", "bass", "lowMid", "mid", "highMid", "presence", "air"]
StemName = Literal["drums", "bass", "vocals", "other"]
SectionLabel = Literal[
    "intro", "verse", "build", "drop", "chorus",
    "breakdown", "bridge", "outro", "silence", "unknown",
]

BAND_EDGES_HZ: Dict[str, tuple] = {
    "sub": (20, 60), "bass": (60, 160), "lowMid": (160, 400), "mid": (400, 1000),
    "highMid": (1000, 3000), "presence": (3000, 8000), "air": (8000, 20000),
}


class KeyInfo(BaseModel):
    tonic: str
    mode: Literal["major", "minor"]
    chroma12: List[float]
    confidence: float


class Section(BaseModel):
    startSec: float
    endSec: float
    label: SectionLabel
    energy: float
    isDrop: bool


class Envelope(BaseModel):
    timesSec: List[float]
    values: List[float]


class DrumHits(BaseModel):
    kick: List[float]
    snare: List[float]
    hat: List[float]


class OnsetStrength(BaseModel):
    kick: Optional[List[float]] = None
    snare: Optional[List[float]] = None
    hat: Optional[List[float]] = None
    bass: Optional[List[float]] = None
    melody: Optional[List[float]] = None


class Spectral(BaseModel):
    timesSec: List[float]
    centroid: List[float]
    flux: List[float]


class Score(BaseModel):
    schemaVersion: Literal[1] = 1
    analyzedBy: Literal[
        "python-allin1+librosa", "python-beatthis+librosa", "essentia-wasm"
    ] = "python-beatthis+librosa"
    generatedAtISO: str
    sourceHash: str

    durationSec: float
    sampleRate: int

    # rhythm
    bpm: float
    tempoConfidence: float
    timeSignature: int = 4
    beatTimesSec: List[float]
    downbeatTimesSec: List[float]
    beatPositions: List[float]

    # onsets
    onsetsByBand: Dict[BandName, List[float]]
    onsetsByStem: Optional[Dict[StemName, List[float]]] = None
    drumHits: Optional[DrumHits] = None
    onsetStrength: Optional[OnsetStrength] = None

    # energy
    energyEnvelope: Envelope
    bandEnergy: Optional[Dict[BandName, Envelope]] = None
    stemEnergy: Optional[Dict[StemName, Envelope]] = None

    # spectral
    spectral: Optional[Spectral] = None

    # structure
    sections: List[Section]

    # harmony
    key: Optional[KeyInfo] = None
