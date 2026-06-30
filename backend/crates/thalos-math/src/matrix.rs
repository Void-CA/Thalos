use crate::Vector3;
use std::fmt;

/// Matriz homogénea 4×4 para transformaciones en ℝ³.
///
/// Almacenada row-major (16 floats):
///
/// ```text
/// | m[0]  m[1]  m[2]  m[3]  |   → fila 0
/// | m[4]  m[5]  m[6]  m[7]  |   → fila 1
/// | m[8]  m[9]  m[10] m[11] |   → fila 2
/// | 0     0     0     1      |   → fila 3
/// ```
///
/// Los 3×3 superiores izquierdos son la rotación **R**, la columna 4 (índices 3,7,11)
/// es la traslación **p**, y la última fila es siempre `[0 0 0 1]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Matrix4x4 {
    pub(crate) m: [f64; 16],
}

// ─── Constructores ──────────────────────────────────────────────

impl Matrix4x4 {
    pub fn identity() -> Self {
        Self {
            m: [
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    /// Construye una matriz homogénea desde una rotación 3×3 y una traslación.
    ///
    /// `rotation` se interpreta row-major:
    /// ```text
    /// r[0] r[1] r[2]
    /// r[3] r[4] r[5]
    /// r[6] r[7] r[8]
    /// ```
    pub fn from_rp(rotation: [[f64; 3]; 3], translation: Vector3) -> Self {
        Self {
            m: [
                rotation[0][0], rotation[0][1], rotation[0][2], translation.x,
                rotation[1][0], rotation[1][1], rotation[1][2], translation.y,
                rotation[2][0], rotation[2][1], rotation[2][2], translation.z,
                0.0, 0.0, 0.0, 1.0,
            ],
        }
    }

    /// Construye desde un slice plano de 16 floats (row-major).
    ///
    /// # Panics
    /// Si el slice no tiene exactamente 16 elementos.
    pub fn from_slice(data: &[f64]) -> Self {
        assert_eq!(data.len(), 16, "Matrix4x4 necesita 16 elementos");
        let mut m = [0.0; 16];
        m.copy_from_slice(data);
        Self { m }
    }

    /// Acceso directo (inmutable) al elemento en fila `r`, columna `c` (0-indexed).
    pub fn get(&self, r: usize, c: usize) -> f64 {
        self.m[r * 4 + c]
    }

    /// Acceso mutable al elemento en fila `r`, columna `c`.
    pub fn get_mut(&mut self, r: usize, c: usize) -> &mut f64 {
        &mut self.m[r * 4 + c]
    }
}

// ─── Descomposición ─────────────────────────────────────────────

impl Matrix4x4 {
    /// Extrae la submatriz de rotación 3×3 (top-left).
    pub fn rotation_matrix(&self) -> [[f64; 3]; 3] {
        [
            [self.m[0], self.m[1], self.m[2]],
            [self.m[4], self.m[5], self.m[6]],
            [self.m[8], self.m[9], self.m[10]],
        ]
    }

    /// Extrae el vector de traslación (columna 4, filas 0-2).
    pub fn translation_vector(&self) -> Vector3 {
        Vector3::new(self.m[3], self.m[7], self.m[11])
    }

    /// Descompone T en (R, p).
    pub fn decompose(&self) -> ([[f64; 3]; 3], Vector3) {
        (self.rotation_matrix(), self.translation_vector())
    }
}

// ─── Operaciones ────────────────────────────────────────────────

impl Matrix4x4 {
    /// Multiplicación de matrices homogéneas: `self * other`.
    ///
    /// Esto es O(64) porque 4×4 – no hay optimizaciones prematuras.
    pub fn mul(&self, other: &Self) -> Self {
        let mut r = [0.0; 16];
        for i in 0..4 {
            for j in 0..4 {
                let mut sum = 0.0;
                for k in 0..4 {
                    sum += self.m[i * 4 + k] * other.m[k * 4 + j];
                }
                r[i * 4 + j] = sum;
            }
        }
        Self { m: r }
    }

    /// Aplica la transformación a un Vector3 (lo extiende a homogéneo w=1).
    pub fn transform_point(&self, point: &Vector3) -> Vector3 {
        let x = self.m[0] * point.x + self.m[1] * point.y + self.m[2] * point.z + self.m[3];
        let y = self.m[4] * point.x + self.m[5] * point.y + self.m[6] * point.z + self.m[7];
        let z = self.m[8] * point.x + self.m[9] * point.y + self.m[10] * point.z + self.m[11];
        Vector3::new(x, y, z)
    }
}

// ─── Display ────────────────────────────────────────────────────

impl fmt::Display for Matrix4x4 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for i in 0..4 {
            let row = [
                self.m[i * 4],
                self.m[i * 4 + 1],
                self.m[i * 4 + 2],
                self.m[i * 4 + 3],
            ];
            if i == 0 {
                write!(f, "⎡")?;
            } else if i == 3 {
                write!(f, "⎣")?;
            } else {
                write!(f, "⎢")?;
            }
            for (_j, val) in row.iter().enumerate() {
                if *val >= 0.0 {
                    write!(f, " {:>8.4} ", val)?;
                } else {
                    write!(f, " {:>8.4} ", val)?;
                }
            }
            if i == 0 {
                writeln!(f, " ⎤")?;
            } else if i == 3 {
                writeln!(f, " ⎦")?;
            } else {
                writeln!(f, " ⎥")?;
            }
        }
        Ok(())
    }
}

/// Imprime una serie de matrices etiquetadas, una por línea compacta.
#[allow(dead_code)]
pub fn print_matrices(labels: &[&str], matrices: &[Matrix4x4]) {
    for (label, mat) in labels.iter().zip(matrices.iter()) {
        println!("{label} =");
        println!("{mat}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::EPS;

    #[test]
    fn identity_has_correct_structure() {
        let i = Matrix4x4::identity();
        assert!((i.m[0] - 1.0).abs() < EPS);
        assert!((i.m[5] - 1.0).abs() < EPS);
        assert!((i.m[10] - 1.0).abs() < EPS);
        assert!((i.m[15] - 1.0).abs() < EPS);
        assert!((i.m[3] - 0.0).abs() < EPS);
    }

    #[test]
    fn mul_identity_is_neutral() {
        let a = Matrix4x4::from_rp(
            [[1.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 3.0]],
            Vector3::new(1.0, 2.0, 3.0),
        );
        let i = Matrix4x4::identity();
        let r = a.mul(&i);
        for (got, expected) in r.m.iter().zip(a.m.iter()) {
            assert!((got - expected).abs() < EPS);
        }
    }

    #[test]
    fn from_rp_roundtrip() {
        let r = [[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]];
        let p = Vector3::new(0.5, 0.3, 0.0);
        let t = Matrix4x4::from_rp(r, p);
        let (r2, p2) = t.decompose();
        for i in 0..3 {
            for j in 0..3 {
                assert!((r2[i][j] - r[i][j]).abs() < EPS);
            }
        }
        assert!((p2.x - 0.5).abs() < EPS);
        assert!((p2.y - 0.3).abs() < EPS);
        assert!((p2.z - 0.0).abs() < EPS);
    }

    #[test]
    fn transform_point_works() {
        let r = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        let p = Vector3::new(1.0, 2.0, 3.0);
        let t = Matrix4x4::from_rp(r, p);
        let v = Vector3::new(1.0, 1.0, 1.0);
        let rv = t.transform_point(&v);
        assert!((rv.x - 2.0).abs() < EPS);
        assert!((rv.y - 3.0).abs() < EPS);
        assert!((rv.z - 4.0).abs() < EPS);
    }

    #[test]
    fn get_and_get_mut_roundtrip() {
        let mut m = Matrix4x4::identity();
        *m.get_mut(1, 2) = 42.0;
        assert!((m.get(1, 2) - 42.0).abs() < EPS);
    }
}
