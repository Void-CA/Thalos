//! URDF → [`Robot`](crate::Robot) parser.
//!
//! ## Usage
//!
//! ```rust
//! # use thalos_models::urdf::parser::parse_robot;
//! let source = r#"
//!   <robot name="my_bot">
//!     <link name="base_link"/>
//!     <link name="head">
//!       <visual>
//!         <geometry><sphere radius="0.1"/></geometry>
//!       </visual>
//!     </link>
//!     <joint name="neck" type="revolute">
//!       <parent link="base_link"/>
//!       <child  link="head"/>
//!       <origin xyz="0 0 0.5" rpy="0 0 0"/>
//!       <axis  xyz="0 0 1"/>
//!     </joint>
//!   </robot>
//! "#;
//!
//! let robot = parse_robot(source).unwrap();
//! assert_eq!(robot.name, "my_bot");
//! assert_eq!(robot.links.len(), 2);
//! assert_eq!(robot.joints.len(), 1);
//! ```

use std::collections::HashMap;
use std::io::BufRead;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::geometry::{Collision, Geometry, Visual};
use crate::joint::{Joint, JointKind, JointLimits};
use crate::link::{InertiaMatrix, Inertial, Link};
use crate::material::{Color, Material};
use crate::robot::Robot;
use thalos_math::{Transform3D, UnitQuaternion, UnitVector3, Vector3};

// ─── Error type ─────────────────────────────────────────────────

/// Errors that can occur during URDF parsing.
#[derive(Debug, Clone)]
pub enum UrdfError {
    /// Invalid XML or I/O error.
    Xml(String),
    /// Required attribute is missing on an element.
    MissingAttribute {
        element: String,
        attribute: String,
    },
    /// Required child element is missing.
    MissingElement {
        parent: String,
        child: String,
    },
    /// A numeric value could not be parsed.
    ParseFloat {
        value: String,
        source: String,
    },
    /// A space-separated tuple (xyz, rpy, rgba, …) has the wrong
    /// number of components.
    TupleLength {
        element: String,
        expected: usize,
        got: usize,
    },
    /// Unknown joint type string.
    UnknownJointType(String),
    /// Zero axis vector (must be non-zero for 1-DOF joints).
    ZeroAxis,
    /// Required attribute `name` is missing or empty.
    UnnamedElement(String),
}

impl std::fmt::Display for UrdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UrdfError::Xml(msg) => write!(f, "XML error: {msg}"),
            UrdfError::MissingAttribute { element, attribute } => {
                write!(f, "<{element}> is missing required attribute `{attribute}`")
            }
            UrdfError::MissingElement { parent, child } => {
                write!(f, "<{parent}> is missing required child <{child}>")
            }
            UrdfError::ParseFloat { value, source } => {
                write!(f, "cannot parse float `{value}`: {source}")
            }
            UrdfError::TupleLength { element, expected, got } => {
                write!(f, "<{element}>: expected {expected} values, got {got}")
            }
            UrdfError::UnknownJointType(t) => {
                write!(f, "unknown joint type `{t}`")
            }
            UrdfError::ZeroAxis => {
                write!(f, "joint axis must be a non-zero vector")
            }
            UrdfError::UnnamedElement(e) => {
                write!(f, "<{e}> is missing the required `name` attribute")
            }
        }
    }
}

impl std::error::Error for UrdfError {}

impl From<quick_xml::Error> for UrdfError {
    fn from(e: quick_xml::Error) -> Self {
        UrdfError::Xml(e.to_string())
    }
}

// ─── Attribute helpers ──────────────────────────────────────────

/// Retrieve an attribute value from a `BytesStart`.
fn attr(elem: &quick_xml::events::BytesStart<'_>, name: &[u8]) -> Result<Option<String>, UrdfError> {
    match elem.try_get_attribute(name) {
        Ok(Some(a)) => Ok(Some(
            a.unescape_value()
                .map_err(|e| UrdfError::Xml(e.to_string()))?
                .into_owned(),
        )),
        Ok(None) => Ok(None),
        Err(e) => Err(UrdfError::Xml(e.to_string())),
    }
}

/// Retrieve a required attribute or return [`MissingAttribute`](UrdfError::MissingAttribute).
fn required_attr(
    elem: &quick_xml::events::BytesStart<'_>,
    name: &[u8],
    element_name: &str,
) -> Result<String, UrdfError> {
    attr(elem, name)?.ok_or_else(|| UrdfError::MissingAttribute {
        element: element_name.to_string(),
        attribute: String::from_utf8_lossy(name).into_owned(),
    })
}

/// Parse a space-separated list of `n` floats.
fn parse_n_floats(s: &str, n: usize, context: &str) -> Result<Vec<f64>, UrdfError> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() != n {
        return Err(UrdfError::TupleLength {
            element: context.to_string(),
            expected: n,
            got: parts.len(),
        });
    }
    parts
        .iter()
        .map(|p| {
            p.parse::<f64>().map_err(|e| UrdfError::ParseFloat {
                value: (*p).to_string(),
                source: e.to_string(),
            })
        })
        .collect()
}

/// Parse `xyz="x y z"`.
fn parse_xyz(s: &str, context: &str) -> Result<Vector3, UrdfError> {
    let v = parse_n_floats(s, 3, context)?;
    Ok(Vector3::new(v[0], v[1], v[2]))
}

/// Parse `rpy="roll pitch yaw"` (radians).
fn parse_rpy(s: &str, context: &str) -> Result<UnitQuaternion, UrdfError> {
    let v = parse_n_floats(s, 3, context)?;
    Ok(UnitQuaternion::from_euler(v[0], v[1], v[2]))
}

/// Parse `rgba="r g b a"`.
fn parse_rgba(s: &str, context: &str) -> Result<Color, UrdfError> {
    let v = parse_n_floats(s, 4, context)?;
    Ok(Color::new(v[0], v[1], v[2], v[3]))
}

/// Parse an `<origin>` element (self-closing).
fn parse_origin(elem: &quick_xml::events::BytesStart<'_>) -> Result<Transform3D, UrdfError> {
    let translation = match attr(elem, b"xyz")? {
        Some(s) => parse_xyz(&s, "origin")?,
        None => Vector3::zero(),
    };
    let rotation = match attr(elem, b"rpy")? {
        Some(s) => parse_rpy(&s, "origin")?,
        None => UnitQuaternion::identity(),
    };
    Ok(Transform3D {
        translation,
        rotation,
    })
}

// ─── Helper: skip unknown elements ──────────────────────────────

/// Skip all events until the matching End tag for the current element.
/// `depth` starts at 1 (the element whose children we're skipping).
fn skip_element<R: BufRead>(reader: &mut Reader<R>, buf: &mut Vec<u8>) -> Result<(), UrdfError> {
    let mut depth: usize = 1;
    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(_) => depth += 1,
            Event::End(_) => {
                depth -= 1;
                if depth == 0 {
                    return Ok(());
                }
            }
            Event::Empty(_) => { /* self-closing, no depth change */ }
            Event::Eof => {
                return Err(UrdfError::Xml("unexpected EOF during skip".into()));
            }
            _ => {}
        }
    }
}

// ─── Element parsers ────────────────────────────────────────────

/// Parse the contents of a `<link>` element.
fn parse_link_body<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
    link: &mut Link,
) -> Result<(), UrdfError> {
    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                match tag.as_slice() {
                    b"inertial" => {
                        link.inertial = Some(parse_inertial(reader, buf)?);
                    }
                    b"visual" => {
                        link.visual.push(parse_visual(reader, buf)?);
                    }
                    b"collision" => {
                        link.collision.push(parse_collision(reader, buf)?);
                    }
                    _ => {
                        skip_element(reader, buf)?;
                    }
                }
            }
            Event::Empty(e) => {
                // Self-closing elements inside <link> (unusual but handle).
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag != b"inertial" && tag != b"visual" && tag != b"collision" {
                    // inertial/visual/collision are never empty in practice
                }
            }
            Event::End(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"link" {
                    return Ok(());
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml("unexpected EOF inside <link>".into()));
            }
            _ => {}
        }
    }
}

fn parse_inertial<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
) -> Result<Inertial, UrdfError> {
    let mut origin = Transform3D::identity();
    let mut mass = None;
    let mut inertia = None;

    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) | Event::Empty(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                match tag.as_slice() {
                    b"origin" => {
                        origin = parse_origin(&e)?;
                    }
                    b"mass" => {
                        let s = required_attr(&e, b"value", "mass")?;
                        mass = Some(
                            s.parse::<f64>()
                                .map_err(|e2| UrdfError::ParseFloat {
                                    value: s,
                                    source: e2.to_string(),
                                })?,
                        );
                    }
                    b"inertia" => {
                        let ixx = required_attr(&e, b"ixx", "inertia")?;
                        let ixy = required_attr(&e, b"ixy", "inertia")?;
                        let ixz = required_attr(&e, b"ixz", "inertia")?;
                        let iyy = required_attr(&e, b"iyy", "inertia")?;
                        let iyz = required_attr(&e, b"iyz", "inertia")?;
                        let izz = required_attr(&e, b"izz", "inertia")?;
                        let parse = |s: &str| {
                            s.parse::<f64>().map_err(|e2| UrdfError::ParseFloat {
                                value: s.to_string(),
                                source: e2.to_string(),
                            })
                        };
                        inertia = Some(InertiaMatrix {
                            ixx: parse(&ixx)?,
                            ixy: parse(&ixy)?,
                            ixz: parse(&ixz)?,
                            iyy: parse(&iyy)?,
                            iyz: parse(&iyz)?,
                            izz: parse(&izz)?,
                        });
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"inertial" {
                    break;
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml(
                    "unexpected EOF inside <inertial>".into(),
                ));
            }
            _ => {}
        }
    }

    let mass = mass.ok_or_else(|| UrdfError::MissingElement {
        parent: "inertial".into(),
        child: "mass".into(),
    })?;
    let inertia = inertia.ok_or_else(|| UrdfError::MissingElement {
        parent: "inertial".into(),
        child: "inertia".into(),
    })?;

    Ok(Inertial {
        origin,
        mass,
        inertia,
    })
}

fn parse_geometry_body<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
) -> Result<Geometry, UrdfError> {
    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) | Event::Empty(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                match tag.as_slice() {
                    b"sphere" => {
                        let r = required_attr(&e, b"radius", "sphere")?;
                        let radius = r.parse::<f64>().map_err(|e2| {
                            UrdfError::ParseFloat {
                                value: r,
                                source: e2.to_string(),
                            }
                        })?;
                        return Ok(Geometry::Sphere { radius });
                    }
                    b"box" => {
                        let s = required_attr(&e, b"size", "box")?;
                        let dims = parse_xyz(&s, "box")?;
                        return Ok(Geometry::Box {
                            width: dims.x,
                            height: dims.y,
                            depth: dims.z,
                        });
                    }
                    b"cylinder" => {
                        let r = required_attr(&e, b"radius", "cylinder")?;
                        let h = required_attr(&e, b"length", "cylinder")?;
                        let radius = r.parse::<f64>().map_err(|e2| {
                            UrdfError::ParseFloat {
                                value: r,
                                source: e2.to_string(),
                            }
                        })?;
                        let height = h.parse::<f64>().map_err(|e2| {
                            UrdfError::ParseFloat {
                                value: h,
                                source: e2.to_string(),
                            }
                        })?;
                        return Ok(Geometry::Cylinder { radius, height });
                    }
                    b"mesh" => {
                        let filename = required_attr(&e, b"filename", "mesh")?;
                        let scale = match attr(&e, b"scale")? {
                            Some(s) => Some(parse_xyz(&s, "mesh")?),
                            None => None,
                        };
                        return Ok(Geometry::Mesh { filename, scale });
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"geometry" {
                    return Err(UrdfError::MissingElement {
                        parent: "geometry".into(),
                        child: "sphere|box|cylinder|mesh".into(),
                    });
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml(
                    "unexpected EOF inside <geometry>".into(),
                ));
            }
            _ => {}
        }
    }
}

fn parse_visual<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
) -> Result<Visual, UrdfError> {
    let mut origin = Transform3D::identity();
    let mut geometry = None;
    let mut material = None;

    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) | Event::Empty(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                match tag.as_slice() {
                    b"origin" => {
                        origin = parse_origin(&e)?;
                    }
                    b"geometry" => {
                        geometry = Some(parse_geometry_body(reader, buf)?);
                    }
                    b"material" => {
                        let e = e.into_owned();
                        material = Some(parse_visual_material(reader, buf, e)?);
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"visual" {
                    break;
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml("unexpected EOF inside <visual>".into()));
            }
            _ => {}
        }
    }

    let geometry = geometry.ok_or_else(|| UrdfError::MissingElement {
        parent: "visual".into(),
        child: "geometry".into(),
    })?;

    Ok(Visual {
        origin,
        geometry,
        material,
    })
}

fn parse_visual_material<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
    _start: quick_xml::events::BytesStart<'_>,
) -> Result<Material, UrdfError> {
    // Try to get name from the <material> opening tag (may be absent for
    // inline materials).
    let name = String::new();
    let mut color = None;

    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) | Event::Empty(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"color" {
                    let s = required_attr(&e, b"rgba", "color")?;
                    color = Some(parse_rgba(&s, "color")?);
                }
            }
            Event::End(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"material" {
                    break;
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml(
                    "unexpected EOF inside <material>".into(),
                ));
            }
            _ => {}
        }
    }

    Ok(Material {
        name,
        color,
        texture: None,
    })
}

fn parse_collision<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
) -> Result<Collision, UrdfError> {
    let mut origin = Transform3D::identity();
    let mut geometry = None;

    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) | Event::Empty(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                match tag.as_slice() {
                    b"origin" => {
                        origin = parse_origin(&e)?;
                    }
                    b"geometry" => {
                        geometry = Some(parse_geometry_body(reader, buf)?);
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"collision" {
                    break;
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml(
                    "unexpected EOF inside <collision>".into(),
                ));
            }
            _ => {}
        }
    }

    let geometry = geometry.ok_or_else(|| UrdfError::MissingElement {
        parent: "collision".into(),
        child: "geometry".into(),
    })?;

    Ok(Collision { origin, geometry })
}

fn parse_joint_body<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
    kind: JointKind,
    name: String,
) -> Result<Joint, UrdfError> {
    let mut origin = Transform3D::identity();
    let mut parent = None;
    let mut child = None;
    let mut axis = None;
    let mut limits = None;

    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) | Event::Empty(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                match tag.as_slice() {
                    b"origin" => {
                        origin = parse_origin(&e)?;
                    }
                    b"parent" => {
                        parent = Some(required_attr(&e, b"link", "parent")?);
                    }
                    b"child" => {
                        child = Some(required_attr(&e, b"link", "child")?);
                    }
                    b"axis" => {
                        let s = required_attr(&e, b"xyz", "axis")?;
                        let v = parse_xyz(&s, "axis")?;
                        if v.norm() < 1e-12 {
                            return Err(UrdfError::ZeroAxis);
                        }
                        axis = Some(
                            UnitVector3::new(v)
                                .map_err(|_| UrdfError::ZeroAxis)?,
                        );
                    }
                    b"limit" => {
                        limits = Some(parse_limit(&e)?);
                    }
                    _ => {} // skip unknown optional elements
                }
            }
            Event::End(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"joint" {
                    break;
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml("unexpected EOF inside <joint>".into()));
            }
            _ => {}
        }
    }

    let parent = parent.ok_or_else(|| UrdfError::MissingElement {
        parent: "joint".into(),
        child: "parent".into(),
    })?;
    let child = child.ok_or_else(|| UrdfError::MissingElement {
        parent: "joint".into(),
        child: "child".into(),
    })?;

    Ok(Joint {
        name,
        kind,
        parent,
        child,
        origin,
        axis,
        limits,
    })
}

fn parse_limit(elem: &quick_xml::events::BytesStart<'_>) -> Result<JointLimits, UrdfError> {
    let lower = match attr(elem, b"lower")? {
        Some(s) => s.parse::<f64>().map_err(|e2| UrdfError::ParseFloat {
            value: s,
            source: e2.to_string(),
        })?,
        None => 0.0,
    };
    let upper = match attr(elem, b"upper")? {
        Some(s) => s.parse::<f64>().map_err(|e2| UrdfError::ParseFloat {
            value: s,
            source: e2.to_string(),
        })?,
        None => 0.0,
    };
    let velocity = match attr(elem, b"velocity")? {
        Some(s) => Some(s.parse::<f64>().map_err(|e2| UrdfError::ParseFloat {
            value: s,
            source: e2.to_string(),
        })?),
        None => None,
    };
    let effort = match attr(elem, b"effort")? {
        Some(s) => Some(s.parse::<f64>().map_err(|e2| UrdfError::ParseFloat {
            value: s,
            source: e2.to_string(),
        })?),
        None => None,
    };

    Ok(JointLimits {
        min: lower,
        max: upper,
        velocity,
        effort,
    })
}

fn parse_global_material<R: BufRead>(
    reader: &mut Reader<R>,
    buf: &mut Vec<u8>,
    start: quick_xml::events::BytesStart<'_>,
) -> Result<Material, UrdfError> {
    let name = required_attr(&start, b"name", "material")?;
    let mut color = None;

    loop {
        buf.clear();
        match reader.read_event_into(buf)? {
            Event::Start(e) | Event::Empty(e) => {
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"color" {
                    let s = required_attr(&e, b"rgba", "color")?;
                    color = Some(parse_rgba(&s, "color")?);
                }
            }
            Event::End(e) => {
                if e.name().as_ref().to_ascii_lowercase() == b"material" {
                    break;
                }
            }
            Event::Eof => {
                return Err(UrdfError::Xml(
                    "unexpected EOF inside <material>".into(),
                ));
            }
            _ => {}
        }
    }

    Ok(Material {
        name,
        color,
        texture: None,
    })
}

fn parse_joint_type(s: &str) -> Result<JointKind, UrdfError> {
    match s {
        "revolute" => Ok(JointKind::Revolute),
        "continuous" => Ok(JointKind::Continuous),
        "prismatic" => Ok(JointKind::Prismatic),
        "fixed" => Ok(JointKind::Fixed),
        "floating" => Ok(JointKind::Floating),
        "planar" => Ok(JointKind::Planar),
        other => Err(UrdfError::UnknownJointType(other.to_string())),
    }
}

// ─── Public API ─────────────────────────────────────────────────

/// Parse a URDF document into a [`Robot`](crate::Robot).
///
/// The root link is determined automatically: the link that is never
/// the child of a joint. If every link appears as a child (cyclic
/// graph) or there are no links, the first link is used.
pub fn parse_robot(source: &str) -> Result<Robot, UrdfError> {
    let mut reader = Reader::from_reader(source.as_bytes());

    let mut buf = Vec::new();

    let mut links: Vec<Link> = Vec::new();
    let mut joints: Vec<Joint> = Vec::new();
    let mut materials: HashMap<String, Material> = HashMap::new();
    let mut robot_name: Option<String> = None;
    let mut child_links: Vec<String> = Vec::new();

    loop {
        buf.clear();
        match reader.read_event_into(&mut buf)? {
            Event::Start(start) => {
                let e = start.into_owned();
                let tag = e.name().as_ref().to_ascii_lowercase();
                match tag.as_slice() {
                    b"robot" => {
                        robot_name = Some(required_attr(&e, b"name", "robot")?);
                    }
                    b"link" => {
                        let name = required_attr(&e, b"name", "link")?;
                        let mut link = Link::new(&name);
                        parse_link_body(&mut reader, &mut buf, &mut link)?;
                        links.push(link);
                    }
                    b"joint" => {
                        let name = required_attr(&e, b"name", "joint")?;
                        let type_str = required_attr(&e, b"type", "joint")?;
                        let kind = parse_joint_type(&type_str)?;
                        let joint = parse_joint_body(&mut reader, &mut buf, kind, name)?;
                        child_links.push(joint.child.clone());
                        joints.push(joint);
                    }
                    b"material" => {
                        let mat = parse_global_material(&mut reader, &mut buf, e)?;
                        materials.insert(mat.name.clone(), mat);
                    }
                    _ => {
                        skip_element(&mut reader, &mut buf)?;
                    }
                }
            }
            Event::End(end) => {
                let tag = end.name().as_ref().to_ascii_lowercase();
                if tag == b"robot" {
                    break;
                }
            }
            Event::Empty(empty) => {
                let e = empty.into_owned();
                let tag = e.name().as_ref().to_ascii_lowercase();
                if tag == b"link" {
                    let name = required_attr(&e, b"name", "link")?;
                    links.push(Link::new(&name));
                } else if tag == b"joint" {
                    let name = required_attr(&e, b"name", "joint")?;
                    let type_str = required_attr(&e, b"type", "joint")?;
                    let kind = parse_joint_type(&type_str)?;
                    // Self-closing <joint/> is invalid URDF (no parent/child),
                    // but parse_joint_body will error with a clear message.
                    let joint = parse_joint_body(&mut reader, &mut buf, kind, name)?;
                    child_links.push(joint.child.clone());
                    joints.push(joint);
                } else if tag == b"material" {
                    let mat = parse_global_material(&mut reader, &mut buf, e)?;
                    materials.insert(mat.name.clone(), mat);
                }
            }
            Event::Eof => {
                break;
            }
            _ => {}
        }
    }

    // Determine root link: the link that is NOT a child in any joint.
    let root_link = if links.is_empty() {
        "world".to_string()
    } else {
        links
            .iter()
            .find(|l| !child_links.contains(&l.name))
            .map(|l| l.name.clone())
            .unwrap_or_else(|| links[0].name.clone())
    };

    let mut robot = Robot::new(
        robot_name.unwrap_or_else(|| "robot".to_string()),
        root_link,
    );

    for link in links {
        robot.add_link(link);
    }
    for joint in joints {
        robot.add_joint(joint);
    }
    robot.materials = materials;

    Ok(robot)
}

// ─── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimal_robot() {
        let source = r#"
            <robot name="test">
                <link name="base"/>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        assert_eq!(robot.name, "test");
        assert_eq!(robot.links.len(), 1);
        assert!(robot.links.contains_key("base"));
        assert!(robot.joints.is_empty());
        assert_eq!(robot.root_link, "base");
    }

    #[test]
    fn robot_with_joint() {
        let source = r#"
            <robot name="arm">
                <link name="base"/>
                <link name="tool"/>
                <joint name="j1" type="revolute">
                    <parent link="base"/>
                    <child link="tool"/>
                    <origin xyz="0 0 1" rpy="0 0 0"/>
                    <axis xyz="0 0 1"/>
                    <limit lower="-1.57" upper="1.57" effort="10" velocity="1"/>
                </joint>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        assert_eq!(robot.joints.len(), 1);
        let joint = &robot.joints["j1"];
        assert_eq!(joint.kind, JointKind::Revolute);
        assert_eq!(joint.parent, "base");
        assert_eq!(joint.child, "tool");
        assert!(joint.axis.is_some());
        let limits = joint.limits.unwrap();
        assert!((limits.min - (-1.57)).abs() < 1e-6);
        assert!((limits.max - 1.57).abs() < 1e-6);
        assert_eq!(limits.velocity, Some(1.0));
        assert_eq!(limits.effort, Some(10.0));
        assert_eq!(robot.root_link, "base");
    }

    #[test]
    fn root_link_detection() {
        let source = r#"
            <robot name="r">
                <link name="a"/>
                <link name="b"/>
                <link name="c"/>
                <joint name="j1" type="fixed">
                    <parent link="a"/>
                    <child link="b"/>
                </joint>
                <joint name="j2" type="fixed">
                    <parent link="b"/>
                    <child link="c"/>
                </joint>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        assert_eq!(robot.root_link, "a");
        assert_eq!(robot.links.len(), 3);
        assert_eq!(robot.joints.len(), 2);
    }

    #[test]
    fn geometry_shapes() {
        let source = r#"
            <robot name="geo">
                <link name="base"/>
                <link name="tip">
                    <visual>
                        <origin xyz="0 0 0.5" rpy="0 0 0"/>
                        <geometry>
                            <sphere radius="0.1"/>
                        </geometry>
                    </visual>
                    <collision>
                        <geometry>
                            <box size="0.2 0.2 0.2"/>
                        </geometry>
                    </collision>
                </link>
                <joint name="j" type="fixed">
                    <parent link="base"/>
                    <child link="tip"/>
                </joint>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        let tip = &robot.links["tip"];
        assert_eq!(tip.visual.len(), 1);
        assert_eq!(tip.collision.len(), 1);

        match &tip.visual[0].geometry {
            Geometry::Sphere { radius } => assert!((*radius - 0.1).abs() < 1e-6),
            _ => panic!("expected sphere"),
        }
        match &tip.collision[0].geometry {
            Geometry::Box {
                width,
                height,
                depth,
            } => {
                assert!((*width - 0.2).abs() < 1e-6);
                assert!((*height - 0.2).abs() < 1e-6);
                assert!((*depth - 0.2).abs() < 1e-6);
            }
            _ => panic!("expected box"),
        }
    }

    #[test]
    fn inertial_parsing() {
        let source = r#"
            <robot name="i">
                <link name="base">
                    <inertial>
                        <origin xyz="0 0 0" rpy="0 0 0"/>
                        <mass value="2.5"/>
                        <inertia ixx="0.1" ixy="0" ixz="0"
                                 iyy="0.1" iyz="0" izz="0.1"/>
                    </inertial>
                </link>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        let inertial = robot.links["base"].inertial.as_ref().unwrap();
        assert!((inertial.mass - 2.5).abs() < 1e-6);
        assert!((inertial.inertia.ixx - 0.1).abs() < 1e-6);
    }

    #[test]
    fn visual_material() {
        let source = r#"
            <robot name="m">
                <link name="base">
                    <visual>
                        <geometry><sphere radius="1"/></geometry>
                        <material name="red">
                            <color rgba="1 0 0 1"/>
                        </material>
                    </visual>
                </link>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        let mat = robot.links["base"]
            .visual[0]
            .material
            .as_ref()
            .unwrap();
        assert_eq!(mat.name, "");
        let color = mat.color.unwrap();
        assert!((color.r - 1.0).abs() < 1e-6);
        assert!((color.g - 0.0).abs() < 1e-6);
        assert!((color.b - 0.0).abs() < 1e-6);
        assert!((color.a - 1.0).abs() < 1e-6);
    }

    #[test]
    fn multiple_joint_types() {
        for (type_str, expected) in [
            ("revolute", JointKind::Revolute),
            ("continuous", JointKind::Continuous),
            ("prismatic", JointKind::Prismatic),
            ("fixed", JointKind::Fixed),
            ("floating", JointKind::Floating),
            ("planar", JointKind::Planar),
        ] {
            let source = format!(
                r#"
                <robot name="jt">
                    <link name="a"/>
                    <link name="b"/>
                    <joint name="j" type="{type_str}">
                        <parent link="a"/>
                        <child link="b"/>
                    </joint>
                </robot>
                "#
            );
            let robot = parse_robot(&source).unwrap();
            assert_eq!(
                robot.joints["j"].kind, expected,
                "mismatch for {type_str}"
            );
        }
    }

    #[test]
    fn error_missing_robot_name() {
        let source = r#"<robot><link name="x"/></robot>"#;
        let err = parse_robot(source).unwrap_err();
        assert!(
            err.to_string().contains("missing required attribute"),
            "got: {err}"
        );
    }

    #[test]
    fn error_unknown_joint_type() {
        let source = r#"
            <robot name="e">
                <link name="a"/><link name="b"/>
                <joint name="j" type="hyperloop">
                    <parent link="a"/><child link="b"/>
                </joint>
            </robot>
        "#;
        let err = parse_robot(source).unwrap_err();
        assert!(err.to_string().contains("unknown joint type"), "got: {err}");
    }

    #[test]
    fn error_missing_parent_in_joint() {
        let source = r#"
            <robot name="e">
                <link name="a"/><link name="b"/>
                <joint name="j" type="fixed">
                    <child link="b"/>
                </joint>
            </robot>
        "#;
        let err = parse_robot(source).unwrap_err();
        assert!(
            err.to_string().contains("missing required child"),
            "got: {err}"
        );
    }

    #[test]
    fn global_material_shared() {
        let source = r#"
            <robot name="g">
                <material name="blue">
                    <color rgba="0 0 1 1"/>
                </material>
                <link name="a"/>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        let mat = &robot.materials["blue"];
        assert_eq!(mat.name, "blue");
        let color = mat.color.unwrap();
        assert!((color.b - 1.0).abs() < 1e-6);
    }

    #[test]
    fn continuous_joint_no_limits() {
        let source = r#"
            <robot name="c">
                <link name="a"/><link name="b"/>
                <joint name="j" type="continuous">
                    <parent link="a"/><child link="b"/>
                    <axis xyz="0 0 1"/>
                </joint>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        let joint = &robot.joints["j"];
        assert_eq!(joint.kind, JointKind::Continuous);
        assert!(joint.limits.is_none());
    }

    #[test]
    fn mesh_geometry_with_scale() {
        let source = r#"
            <robot name="m">
                <link name="base">
                    <visual>
                        <geometry>
                            <mesh filename="package://meshes/arm.stl" scale="1 2 1"/>
                        </geometry>
                    </visual>
                </link>
            </robot>
        "#;
        let robot = parse_robot(source).unwrap();
        let visual = &robot.links["base"].visual[0];
        match &visual.geometry {
            Geometry::Mesh { filename, scale } => {
                assert_eq!(filename, "package://meshes/arm.stl");
                let s = scale.unwrap();
                assert!((s.x - 1.0).abs() < 1e-6);
                assert!((s.y - 2.0).abs() < 1e-6);
                assert!((s.z - 1.0).abs() < 1e-6);
            }
            _ => panic!("expected mesh"),
        }
    }
}
