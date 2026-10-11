# SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""Write src/samples/test-structures.sdf: four synthetic structures of different shape, about 30 um high.

Run it with a Python that has sdfio installed: ``python tools/generate_sample.py``.
"""

from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import sdfio

OUTPUT = Path(__file__).parent.parent / "src" / "samples" / "test-structures.sdf"
TRAILER = (
    "Description = Synthetic test structures\r\n"
    "Structures = microlens array, V-grooves, stepped pyramid, star\r\n"
    "Defects = scratch, dropouts\r\n"
)

STEP = 1e-6  # sampling interval in meters
ROWS, COLUMNS = 300, 400
QUADRANT = 200e-6


def lenses(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """A 4 x 3 array of spherical lenses of 50 um pitch."""
    pitch, radius, curvature = 50e-6, 22e-6, 40e-6
    r = np.minimum(np.hypot(x % pitch - pitch / 2, y % pitch - pitch / 2), radius)

    def sag(distance: np.ndarray | float) -> np.ndarray | float:
        return curvature - np.sqrt(curvature**2 - distance**2)

    return sag(radius) - sag(r)


def grooves(x: np.ndarray) -> np.ndarray:
    """A triangular grating of 20 um pitch and 8 um depth."""
    pitch, depth = 20e-6, 8e-6
    return depth * np.abs((x % pitch) / pitch * 2 - 1)


def pyramid(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """A pyramid of four steps of 5 um on a square of 120 um."""
    distance = np.maximum(np.abs(x - 100e-6), np.abs(y - 75e-6))
    return 5e-6 * np.clip(np.floor((60e-6 - distance) / 15e-6) + 1, 0, 4)


def star(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """A star of eight arms, 25 um high, that fades out at a radius of 65 um."""
    dx, dy = x - 100e-6, y - 75e-6
    radius, angle = np.hypot(dx, dy), np.arctan2(dy, dx)
    arms = 0.5 + 0.5 * np.cos(8 * angle)
    fade = np.clip((65e-6 - radius) / 25e-6, 0, 1)
    return 25e-6 * arms * fade * (1 - 0.4 * np.clip(radius / 65e-6, 0, 1))


def build() -> np.ndarray:
    """The heights in meters: lenses at the bottom left, grooves at the bottom right, the pyramid at the top left."""
    y, x = np.mgrid[0:ROWS, 0:COLUMNS] * STEP
    rng = np.random.default_rng(25178)
    z = np.zeros(x.shape)
    left, bottom = x < QUADRANT, y < 150e-6
    z = np.where(left & bottom, lenses(x, y), z)
    z = np.where(~left & bottom, grooves(x - QUADRANT), z)
    z = np.where(left & ~bottom, pyramid(x, y - 150e-6), z)
    z = np.where(~left & ~bottom, star(x - QUADRANT, y - 150e-6), z)
    z -= 0.6e-6 * np.exp(-((y - 0.4 * x - 120e-6) ** 2) / (2 * (1.5e-6) ** 2)) * (z > 0)  # scratch
    z += 20e-9 * rng.standard_normal(z.shape)  # roughness
    z[np.hypot(x - 300e-6, y - 60e-6) < 6e-6] = np.nan  # specular dropout
    z[rng.random(z.shape) < 0.0002] = np.nan  # random dropouts
    return z


def main() -> None:
    """Write the sample with fixed dates, so that writing it again changes nothing."""
    date = datetime(2026, 10, 11, tzinfo=UTC)
    metadata = sdfio.SdfMetadata(
        manufacturer_id="sdflens",
        data_type=sdfio.DataType.INT16,
        create_date=date,
        mod_date=date,
    )
    OUTPUT.parent.mkdir(exist_ok=True)
    sdfio.write(OUTPUT, build(), x_scale=STEP, y_scale=STEP, z_scale=2e-9, metadata=metadata, trailer=TRAILER)


if __name__ == "__main__":
    main()
