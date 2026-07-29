use std::collections::HashMap;

use thalos_core::motion::MotionPose;

use crate::resource::{LocationId, ObjectId, ToolId};

use super::{GraspPlan, KnowledgeProvider, LoweringError, PlacementPlan};

/// A `KnowledgeProvider` backed by a scene model.
///
/// Resolves semantic identifiers (`ObjectId`, `LocationId`) into geometric
/// frames using pre-configured object and location poses. Approach and retreat
/// frames are derived from the object/location pose with a configurable Z
/// offset.
///
/// # Example
///
/// ```rust
/// use std::collections::HashMap;
/// use thalos_core::motion::MotionPose;
/// use thalos_semantic::knowledge::scene::SceneKnowledgeProvider;
/// use thalos_semantic::resource::{ObjectId, LocationId};
///
/// let provider = SceneKnowledgeProvider::new(
///     HashMap::from([(
///         ObjectId("bolt".into()),
///         MotionPose {
///             position: [0.5, 0.0, 0.0],
///             orientation: [0.0, 0.0, 0.0, 1.0],
///             frame: "world".into(),
///         },
///     )]),
///     HashMap::from([(
///         LocationId("tray".into()),
///         MotionPose {
///             position: [0.8, -0.3, 0.0],
///             orientation: [0.0, 0.0, 0.0, 1.0],
///             frame: "world".into(),
///         },
///     )]),
///     Some(MotionPose {
///         position: [0.0, 0.0, 0.0],
///         orientation: [0.0, 0.0, 0.0, 1.0],
///         frame: "world".into(),
///     }),
/// );
/// ```
pub struct SceneKnowledgeProvider {
    objects: HashMap<ObjectId, MotionPose>,
    locations: HashMap<LocationId, MotionPose>,
    home: Option<MotionPose>,
    /// Z offset applied to approach and retreat frames (default: 0.05).
    approach_offset_z: f64,
}

impl SceneKnowledgeProvider {
    /// Create a new provider with the given object poses, location poses,
    /// and optional home pose.
    pub fn new(
        objects: HashMap<ObjectId, MotionPose>,
        locations: HashMap<LocationId, MotionPose>,
        home: Option<MotionPose>,
    ) -> Self {
        Self {
            objects,
            locations,
            home,
            approach_offset_z: 0.05,
        }
    }

    /// Set the Z offset used for approach and retreat frames.
    pub fn with_approach_offset(mut self, offset: f64) -> Self {
        self.approach_offset_z = offset;
        self
    }

    fn offset_pose(pose: &MotionPose, dz: f64) -> MotionPose {
        MotionPose {
            position: [pose.position[0], pose.position[1], pose.position[2] + dz],
            orientation: pose.orientation,
            frame: pose.frame.clone(),
        }
    }
}

impl KnowledgeProvider for SceneKnowledgeProvider {
    fn grasp_plan(&self, object: &ObjectId) -> Result<GraspPlan, LoweringError> {
        let grasp_frame = self
            .objects
            .get(object)
            .ok_or_else(|| LoweringError::KnowledgeProvider(format!("unknown object '{}'", object.0)))?
            .clone();
        Ok(GraspPlan {
            approach_frame: Self::offset_pose(&grasp_frame, self.approach_offset_z),
            grasp_frame: grasp_frame.clone(),
            retreat_frame: Self::offset_pose(&grasp_frame, -self.approach_offset_z),
            preferred_tool: None,
        })
    }

    fn place_plan(
        &self,
        _object: &ObjectId,
        location: &LocationId,
    ) -> Result<PlacementPlan, LoweringError> {
        let drop_frame = self
            .locations
            .get(location)
            .ok_or_else(|| {
                LoweringError::KnowledgeProvider(format!("unknown location '{}'", location.0))
            })?
            .clone();
        Ok(PlacementPlan {
            approach_frame: Self::offset_pose(&drop_frame, self.approach_offset_z),
            drop_frame: drop_frame.clone(),
            retreat_frame: Self::offset_pose(&drop_frame, -self.approach_offset_z),
        })
    }

    fn location_pose(&self, location: &LocationId) -> Result<MotionPose, LoweringError> {
        self.locations.get(location).cloned().ok_or_else(|| {
            LoweringError::KnowledgeProvider(format!("unknown location '{}'", location.0))
        })
    }

    fn home_pose(&self) -> Result<MotionPose, LoweringError> {
        self.home
            .clone()
            .ok_or(LoweringError::MissingHomePose)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_pose(x: f64, y: f64, z: f64) -> MotionPose {
        MotionPose {
            position: [x, y, z],
            orientation: [0.0, 0.0, 0.0, 1.0],
            frame: "world".into(),
        }
    }

    #[test]
    fn grasp_plan_returns_frames() {
        let mut objects = HashMap::new();
        objects.insert(ObjectId("bolt".into()), sample_pose(0.5, 0.0, 0.0));
        let provider =
            SceneKnowledgeProvider::new(objects, HashMap::new(), Some(sample_pose(0.0, 0.0, 0.0)));

        let plan = provider.grasp_plan(&ObjectId("bolt".into())).unwrap();
        assert_eq!(plan.grasp_frame.position[0], 0.5);
        assert!(plan.approach_frame.position[2] > 0.0, "approach should have Z offset");
        assert!(plan.retreat_frame.position[2] < 0.0, "retreat should have negative Z offset");
    }

    #[test]
    fn grasp_plan_unknown_object_returns_error() {
        let provider =
            SceneKnowledgeProvider::new(HashMap::new(), HashMap::new(), None);
        let result = provider.grasp_plan(&ObjectId("ghost".into()));
        assert!(result.is_err());
    }

    #[test]
    fn place_plan_returns_frames() {
        let mut locations = HashMap::new();
        locations.insert(LocationId("tray".into()), sample_pose(0.8, -0.3, 0.0));
        let provider =
            SceneKnowledgeProvider::new(HashMap::new(), locations, Some(sample_pose(0.0, 0.0, 0.0)));

        let plan = provider
            .place_plan(&ObjectId("bolt".into()), &LocationId("tray".into()))
            .unwrap();
        assert_eq!(plan.drop_frame.position[0], 0.8);
        assert_eq!(plan.drop_frame.position[1], -0.3);
    }

    #[test]
    fn location_pose_returns_pose() {
        let mut locations = HashMap::new();
        locations.insert(
            LocationId("station".into()),
            sample_pose(1.0, 0.0, 0.0),
        );
        let provider =
            SceneKnowledgeProvider::new(HashMap::new(), locations, Some(sample_pose(0.0, 0.0, 0.0)));

        let pose = provider.location_pose(&LocationId("station".into())).unwrap();
        assert_eq!(pose.position[0], 1.0);
    }

    #[test]
    fn home_pose_returns_configured_pose() {
        let provider = SceneKnowledgeProvider::new(
            HashMap::new(),
            HashMap::new(),
            Some(sample_pose(0.0, 0.5, 0.0)),
        );
        let pose = provider.home_pose().unwrap();
        assert_eq!(pose.position[1], 0.5);
    }

    #[test]
    fn home_pose_missing_returns_error() {
        let provider = SceneKnowledgeProvider::new(HashMap::new(), HashMap::new(), None);
        assert!(provider.home_pose().is_err());
    }

    #[test]
    fn custom_approach_offset() {
        let mut objects = HashMap::new();
        objects.insert(ObjectId("bolt".into()), sample_pose(0.5, 0.0, 0.0));
        let provider = SceneKnowledgeProvider::new(objects, HashMap::new(), None)
            .with_approach_offset(0.1);

        let plan = provider.grasp_plan(&ObjectId("bolt".into())).unwrap();
        assert!((plan.approach_frame.position[2] - 0.1).abs() < 1e-10);
    }
}
