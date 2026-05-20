use crate::prelude::*;
use crate::models::factories::create_single_revolute;

#[test]
    fn zero_angle_returns_x_position() {
        let robot = create_single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        
        // Obtener la pose del único frame
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        // Verificar reference es World
        assert_eq!(
            pose.reference_id(),
            FrameId::World,
            "Reference should be World"
        );
        
        // Verificar posición: (1, 0, 0) - solo el link en X
        let t = &pose.transform().translation;
        assert!(
            (t.x - 1.0).abs() < EPS
                && t.y.abs() < EPS
                && t.z.abs() < EPS,
            "Position should be (1, 0, 0), got ({}, {}, {})",
            t.x, t.y, t.z
        );
    }

    #[test]
    fn pi_over_2_returns_y_position() {
        let robot = create_single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        // q = π/2 = 90 grados
        let result = fk.evaluate(&[PI / 2.0]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        // Verificar posición: (0, 1, 0) - link rotado 90° en Z
        let t = &pose.transform().translation;
        assert!(
            t.x.abs() < EPS
                && (t.y - 1.0).abs() < EPS
                && t.z.abs() < EPS,
            "Position should be (0, 1, 0), got ({}, {}, {})",
            t.x, t.y, t.z
        );
    }

    #[test]
    fn pi_returns_negative_x_position() {
        let robot = create_single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        // q = π = 180 grados
        let result = fk.evaluate(&[PI]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        // Verificar posición: (-1, 0, 0) - link rotado 180° en Z
        let t = &pose.transform().translation;
        assert!(
            (t.x + 1.0).abs() < EPS
                && t.y.abs() < EPS
                && t.z.abs() < EPS,
            "Position should be (-1, 0, 0), got ({}, {}, {})",
            t.x, t.y, t.z
        );
    }

    #[test]
    fn has_one_pose() {
        let robot = create_single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        let frames: Vec<_> = result.frames().collect();
        
        assert_eq!(frames.len(), 1, "Should have exactly one pose");
    }

    #[test]
    fn pose_target_is_child_frame() {
        let robot = create_single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        assert_eq!(
            pose.target_id(),
            *child_frame,
            "Target frame should be the child frame"
        );
    }

    #[test]
    fn pose_is_global() {
        let robot = create_single_revolute();
        let fk = ForwardKinematics::new(robot);
        
        let result = fk.evaluate(&[0.0]);
        
        let child_frame = result.frames().next().unwrap();
        let pose = result.pose(child_frame).unwrap();
        
        assert!(
            pose.is_global(),
            "Pose should be global (reference == World)"
        );
    }