use crate::matrix::Matrix4x4;
use std::fmt;

// ─── Tipos básicos ──────────────────────────────────────────────

/// Parámetro de Denavit–Hartenberg para un eslabón.
///
/// Convención **estándar (Craig)**: la matriz homogénea Aᵢ
/// se obtiene como:
///
/// ```text
/// Aᵢ = Rot_z(θ) · Trans_z(d) · Trans_x(a) · Rot_x(α)
/// ```
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DHParameter {
    /// Ángulo de torsión αᵢ [rad] — giro alrededor de xᵢ
    pub alpha: f64,
    /// Longitud del eslabón aᵢ — distancia sobre xᵢ
    pub a: f64,
    /// Distancia entre eslabones dᵢ — desplazamiento sobre zᵢ
    pub d: f64,
    /// Ángulo de la articulación θᵢ [rad] — giro alrededor de zᵢ
    pub theta: f64,
}

impl DHParameter {
    pub fn new(alpha: f64, a: f64, d: f64, theta: f64) -> Self {
        Self { alpha, a, d, theta }
    }
}

/// Tipo de articulación para la generación de tabla DH.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum JointType {
    Revolute,
    Prismatic,
}

/// Descripción geométrica de un eslabón para generar la tabla DH.
///
/// Para una articulación **revolute**:
///   - `theta` es la variable (se usa como valor inicial)
///   - `d` es fijo
///
/// Para una articulación **prismatic**:
///   - `d` es la variable (se usa como valor inicial)
///   - `theta` es fijo
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GeometricLink {
    pub joint_type: JointType,
    pub alpha: f64,
    pub a: f64,
    pub d: f64,
    pub theta: f64,
}

// ─── Matriz Aᵢ desde un parámetro DH ───────────────────────────

/// Calcula la matriz homogénea Aᵢ 4×4 a partir de un parámetro DH.
///
/// Fórmula (Craig):
/// ```text
///      [cosθ  -sinθ cosα   sinθ sinα   a cosθ]
/// Aᵢ = [sinθ   cosθ cosα  -cosθ sinα   a sinθ]
///      [0      sinα        cosα        d      ]
///      [0      0           0           1      ]
/// ```
pub fn compute_a_matrix(dh: &DHParameter) -> Matrix4x4 {
    let (s_theta, c_theta) = dh.theta.sin_cos();
    let (s_alpha, c_alpha) = dh.alpha.sin_cos();

    Matrix4x4 {
        m: [
            c_theta,
            -s_theta * c_alpha,
            s_theta * s_alpha,
            dh.a * c_theta,
            s_theta,
            c_theta * c_alpha,
            -c_theta * s_alpha,
            dh.a * s_theta,
            0.0,
            s_alpha,
            c_alpha,
            dh.d,
            0.0,
            0.0,
            0.0,
            1.0,
        ],
    }
}

// ─── Solver paso a paso ─────────────────────────────────────────

/// Resultado completo del solver DH con todos los pasos intermedios.
#[derive(Debug, Clone)]
pub struct DHSolution {
    /// Tabla DH de entrada
    pub table: Vec<DHParameter>,
    /// Matrices Aᵢ individuales (una por eslabón)
    pub a_matrices: Vec<Matrix4x4>,
    /// Productos acumulados: [A₁, A₁A₂, A₁A₂A₃, ..., T₀ⁿ]
    pub intermediates: Vec<Matrix4x4>,
    /// Matriz final T₀ⁿ = A₁·A₂·…·Aₙ
    pub final_transform: Matrix4x4,
}

/// Solver de cinemática directa Denavit–Hartenberg con tracking de pasos.
///
/// NO es una caja negra: cada paso (Aᵢ individual, producto intermedio)
/// queda registrado en [`DHSolution`] y se puede inspeccionar o imprimir.
///
/// # Ejemplo
///
/// ```ignore
/// use thalos_math::dh::{DHParameter, DHSolver};
///
/// let params = vec![
///     DHParameter::new(0.0, 0.0, 0.0, std::f64::consts::FRAC_PI_2),
///     DHParameter::new(0.0, 0.5, 0.0, 0.0),
/// ];
/// let solver = DHSolver::new(params);
/// let solution = solver.solve();
/// println!("{}", solution);
/// ```
#[derive(Debug, Clone)]
pub struct DHSolver {
    params: Vec<DHParameter>,
}

impl DHSolver {
    pub fn new(params: Vec<DHParameter>) -> Self {
        Self { params }
    }

    /// Calcula las matrices Aᵢ individuales, una por eslabón.
    pub fn compute_a_matrices(&self) -> Vec<Matrix4x4> {
        self.params.iter().map(compute_a_matrix).collect()
    }

    /// Calcula los productos intermedios:
    /// `[A₁, A₁·A₂, A₁·A₂·A₃, ..., T₀ⁿ]`
    pub fn compute_intermediates(&self) -> Vec<Matrix4x4> {
        let a_mats = self.compute_a_matrices();
        let mut acc = Matrix4x4::identity();
        let mut result = Vec::with_capacity(a_mats.len());

        for a in &a_mats {
            acc = acc.mul(a);
            result.push(acc);
        }

        result
    }

    /// Calcula la matriz final T₀ⁿ.
    pub fn compute_final(&self) -> Matrix4x4 {
        let mut acc = Matrix4x4::identity();
        for a in &self.compute_a_matrices() {
            acc = acc.mul(&a);
        }
        acc
    }

    /// Ejecuta el solver completo y devuelve todos los pasos.
    pub fn solve(&self) -> DHSolution {
        let a_matrices = self.compute_a_matrices();
        let intermediates = self.compute_intermediates();
        let final_transform = intermediates
            .last()
            .copied()
            .unwrap_or(Matrix4x4::identity());

        DHSolution {
            table: self.params.clone(),
            a_matrices,
            intermediates,
            final_transform,
        }
    }
}

// ─── Display de DHSolution ──────────────────────────────────────

impl fmt::Display for DHSolution {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let n = self.table.len();

        // ── Tabla DH ────────────────────────────────────────────
        writeln!(f, "{}", "═".repeat(60))?;
        writeln!(f, "  TABLA DH  (convención estándar / Craig)")?;
        writeln!(f, "{}", "═".repeat(60))?;
        writeln!(
            f,
            " i │   αᵢ [rad]   │   aᵢ        │   dᵢ        │   θᵢ [rad]"
        )?;
        writeln!(f, "{}", "─".repeat(60))?;
        for (i, p) in self.table.iter().enumerate() {
            writeln!(
                f,
                " {} │ {:>11.4} │ {:>10.4} │ {:>10.4} │ {:>10.4}",
                i + 1,
                p.alpha,
                p.a,
                p.d,
                p.theta
            )?;
        }

        // ── Matrices Aᵢ ─────────────────────────────────────────
        writeln!(f)?;
        writeln!(f, "{}", "═".repeat(60))?;
        writeln!(f, "  MATRICES Aᵢ")?;
        writeln!(f, "{}", "═".repeat(60))?;
        for (i, a) in self.a_matrices.iter().enumerate() {
            writeln!(f, "\nA{} =", i + 1)?;
            write!(f, "{a}")?;
        }

        // ── Productos intermedios ───────────────────────────────
        writeln!(f)?;
        writeln!(f, "{}", "═".repeat(60))?;
        writeln!(f, "  PRODUCTOS INTERMEDIOS")?;
        writeln!(f, "{}", "═".repeat(60))?;

        for (i, inter) in self.intermediates.iter().enumerate() {
            let label = if i == 0 {
                format!("A₁")
            } else if i == n - 1 {
                format!("T₀ⁿ = A₁·A₂·…·A{}", n)
            } else {
                let prod: Vec<String> = (1..=i + 1).map(|j| format!("A{}", j)).collect();
                format!("{}", prod.join("·"))
            };
            writeln!(f, "\n{label} =")?;
            write!(f, "{inter}")?;
        }

        // ── Matriz final ────────────────────────────────────────
        writeln!(f)?;
        writeln!(f, "{}", "═".repeat(60))?;
        writeln!(f, "  MATRIZ FINAL  T₀ⁿ")?;
        writeln!(f, "{}", "═".repeat(60))?;
        writeln!(f, "\nT₀ⁿ =")?;
        write!(f, "{}", self.final_transform)?;

        // ── Descomposición ──────────────────────────────────────
        writeln!(f)?;
        writeln!(f, "{}", "═".repeat(60))?;
        writeln!(f, "  DESCOMPOSICIÓN  T₀ⁿ → (R, p)")?;
        writeln!(f, "{}", "═".repeat(60))?;
        let (r, p) = self.final_transform.decompose();
        writeln!(f, "\nR =")?;
        for i in 0..3 {
            if i == 0 {
                write!(f, "⎡")?;
            } else if i == 2 {
                write!(f, "⎣")?;
            } else {
                write!(f, "⎢")?;
            }
            for j in 0..3 {
                if r[i][j] >= 0.0 {
                    write!(f, " {:>8.4} ", r[i][j])?;
                } else {
                    write!(f, " {:>8.4} ", r[i][j])?;
                }
            }
            if i == 0 {
                writeln!(f, " ⎤")?;
            } else if i == 2 {
                writeln!(f, " ⎦")?;
            } else {
                writeln!(f, " ⎥")?;
            }
        }
        writeln!(f, "\np =  [{:.4}, {:.4}, {:.4}]ᵀ", p.x, p.y, p.z)?;

        Ok(())
    }
}

// ─── Generador de tabla DH desde descripción geométrica ─────────

/// Genera la tabla DH a partir de una descripción geométrica de los eslabones.
///
/// Esto NO es magia: simplemente empaqueta los valores que definiste
/// en [`DHParameter`], marcando la variable correspondiente según el
/// tipo de articulación.
///
/// La idea es que tengas una estructura clara para **pensar** la tabla,
/// no que la máquina la resuelva por vos. El verdadero entrenamiento
/// está en construir los [`GeometricLink`] a partir del diagrama del robot.
///
/// # Articulaciones
///
/// | Tipo        | Variable | Fijo        |
/// |-------------|----------|-------------|
/// | `Revolute`  | θ        | α, a, d     |
/// | `Prismatic` | d        | α, a, θ     |
///
/// # Ejemplo (SCARA de 2 DOF)
///
/// ```ignore
/// use thalos_math::dh::{GeometricLink, JointType, generate_dh_table};
///
/// let links = vec![
///     GeometricLink {
///         joint_type: JointType::Revolute,
///         alpha: 0.0,  a: 0.5,  d: 0.2,  theta: 0.0,  // θ₁ variable
///     },
///     GeometricLink {
///         joint_type: JointType::Revolute,
///         alpha: 0.0,  a: 0.3,  d: 0.0,  theta: 0.0,  // θ₂ variable
///     },
/// ];
/// let table = generate_dh_table(&links);
/// ```
pub fn generate_dh_table(links: &[GeometricLink]) -> Vec<DHParameter> {
    links
        .iter()
        .map(|link| DHParameter {
            alpha: link.alpha,
            a: link.a,
            d: link.d,
            theta: link.theta,
        })
        .collect()
}

// ─── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::EPS;
    use std::f64::consts::{FRAC_PI_2, PI};

    fn approx_matrix(a: &Matrix4x4, b: &Matrix4x4, tol: f64) -> bool {
        a.m.iter().zip(b.m.iter()).all(|(x, y)| (x - y).abs() < tol)
    }

    // ─── compute_a_matrix ────────────────────────────────────────

    #[test]
    fn a_matrix_pure_rotation_z() {
        // θ = 90°, α=a=d=0 → Rot_z(90°)
        let dh = DHParameter::new(0.0, 0.0, 0.0, FRAC_PI_2);
        let a = compute_a_matrix(&dh);

        // Rot_z: cos90=0, sin90=1
        let expected = Matrix4x4 {
            m: [
                0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        };
        assert!(approx_matrix(&a, &expected, EPS));
    }

    #[test]
    fn a_matrix_pure_translation_x() {
        // a = 0.5, α=0, d=0, θ=0 → Trans_x(0.5)
        let dh = DHParameter::new(0.0, 0.5, 0.0, 0.0);
        let a = compute_a_matrix(&dh);

        let expected = Matrix4x4 {
            m: [
                1.0, 0.0, 0.0, 0.5, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        };
        assert!(approx_matrix(&a, &expected, EPS));
    }

    #[test]
    fn a_matrix_rotation_x_90() {
        // α = 90°, a=0, d=0, θ=0 → Rot_x(90°)
        let dh = DHParameter::new(FRAC_PI_2, 0.0, 0.0, 0.0);
        let a = compute_a_matrix(&dh);

        // Rot_x(90°): cos90=0, sin90=1
        let expected = Matrix4x4 {
            m: [
                1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        };
        assert!(approx_matrix(&a, &expected, EPS));
    }

    // ─── DHSolver ───────────────────────────────────────────────

    #[test]
    fn solver_empty_table_returns_identity() {
        let solver = DHSolver::new(vec![]);
        let sol = solver.solve();
        assert!(approx_matrix(
            &sol.final_transform,
            &Matrix4x4::identity(),
            EPS
        ));
        assert!(sol.a_matrices.is_empty());
        assert!(sol.intermediates.is_empty());
    }

    #[test]
    fn solver_single_joint() {
        // Solo Rot_z(90°)
        let dh = DHParameter::new(0.0, 0.0, 0.0, FRAC_PI_2);
        let solver = DHSolver::new(vec![dh]);
        let sol = solver.solve();

        assert_eq!(sol.a_matrices.len(), 1);
        assert_eq!(sol.intermediates.len(), 1);
        assert!(approx_matrix(&sol.final_transform, &sol.a_matrices[0], EPS));
    }

    #[test]
    fn solver_two_joints_known_robot() {
        // Simula un robot planar 2R:
        // Eslabón 1: a=L1, α=0, d=0, θ=θ1
        // Eslabón 2: a=L2, α=0, d=0, θ=θ2
        let l1 = 0.5;
        let l2 = 0.3;
        let t1 = PI / 4.0;
        let t2 = PI / 6.0;

        let params = vec![
            DHParameter::new(0.0, l1, 0.0, t1),
            DHParameter::new(0.0, l2, 0.0, t2),
        ];

        let solver = DHSolver::new(params);
        let sol = solver.solve();

        // Verificar: la posición del efector final debe ser:
        // x = L1*cos(θ1) + L2*cos(θ1+θ2)
        // y = L1*sin(θ1) + L2*sin(θ1+θ2)
        let p = sol.final_transform.translation_vector();
        let expected_x = l1 * t1.cos() + l2 * (t1 + t2).cos();
        let expected_y = l1 * t1.sin() + l2 * (t1 + t2).sin();

        assert!(
            (p.x - expected_x).abs() < EPS,
            "x: {} != {}",
            p.x,
            expected_x
        );
        assert!(
            (p.y - expected_y).abs() < EPS,
            "y: {} != {}",
            p.y,
            expected_y
        );
        assert!((p.z - 0.0).abs() < EPS, "z: {} != 0", p.z);
    }

    #[test]
    fn solver_intermediates_match_final() {
        let params = vec![
            DHParameter::new(0.0, 0.5, 0.0, 0.3),
            DHParameter::new(FRAC_PI_2, 0.0, 0.1, 0.0),
            DHParameter::new(0.0, 0.3, 0.0, 0.5),
        ];
        let solver = DHSolver::new(params);
        let sol = solver.solve();

        // El último intermedio debe ser igual a final_transform
        assert!(approx_matrix(
            sol.intermediates.last().unwrap(),
            &sol.final_transform,
            EPS
        ));
    }

    #[test]
    fn solver_intermediates_are_cumulative() {
        let params = vec![
            DHParameter::new(0.0, 0.5, 0.0, 0.3),
            DHParameter::new(FRAC_PI_2, 0.0, 0.1, 0.0),
        ];
        let solver = DHSolver::new(params);
        let sol = solver.solve();

        // intermediate[0] == A₁
        assert!(approx_matrix(
            &sol.intermediates[0],
            &sol.a_matrices[0],
            EPS
        ));

        // intermediate[1] == A₁·A₂
        let expected = sol.a_matrices[0].mul(&sol.a_matrices[1]);
        assert!(approx_matrix(&sol.intermediates[1], &expected, EPS));
    }

    // ─── generate_dh_table ──────────────────────────────────────

    #[test]
    fn generate_table_preserves_values() {
        let links = vec![
            GeometricLink {
                joint_type: JointType::Revolute,
                alpha: 0.0,
                a: 0.5,
                d: 0.2,
                theta: 0.0,
            },
            GeometricLink {
                joint_type: JointType::Prismatic,
                alpha: FRAC_PI_2,
                a: 0.0,
                d: 0.1,
                theta: 0.0,
            },
        ];

        let table = generate_dh_table(&links);
        assert_eq!(table.len(), 2);
        assert!((table[0].alpha - 0.0).abs() < EPS);
        assert!((table[0].a - 0.5).abs() < EPS);
        assert!((table[0].d - 0.2).abs() < EPS);
        assert!((table[0].theta - 0.0).abs() < EPS);
        assert!((table[1].alpha - FRAC_PI_2).abs() < EPS);
    }

    // ─── DHSolution Display no panics ────────────────────────────

    #[test]
    fn solution_display_does_not_crash() {
        let params = vec![
            DHParameter::new(0.0, 0.5, 0.0, 0.3),
            DHParameter::new(FRAC_PI_2, 0.0, 0.1, 0.0),
        ];
        let solver = DHSolver::new(params);
        let sol = solver.solve();
        let output = format!("{}", sol);
        assert!(!output.is_empty());
        assert!(output.contains("TABLA DH"));
        assert!(output.contains("MATRICES Aᵢ"));
        assert!(output.contains("PRODUCTOS INTERMEDIOS"));
        assert!(output.contains("MATRIZ FINAL"));
        assert!(output.contains("DESCOMPOSICIÓN"));
    }
}
