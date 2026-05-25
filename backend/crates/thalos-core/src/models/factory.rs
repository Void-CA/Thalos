use std::collections::HashMap;

use crate::robot::serial_chain::SerialChain;


pub trait RobotFactory: Send + Sync {
    fn name(&self) -> &'static str;

    /// Build a fully configured SerialChain.
    fn build(&self) -> SerialChain;
}


pub struct RobotRegistry {
    factories: HashMap<String, Box<dyn RobotFactory>>,
}

impl RobotRegistry {
    pub fn new() -> Self {
        Self {
            factories: HashMap::new(),
        }
    }

    pub fn register(&mut self, factory: Box<dyn RobotFactory>) {
        self.factories.insert(factory.name().to_string(), factory);
    }

    pub fn build(&self, name: &str) -> Option<SerialChain> {
        self.factories.get(name).map(|f| f.build())
    }
}
