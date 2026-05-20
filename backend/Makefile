MODELS_DIR=src/models

robot:
	@if [ -z "$(NAME)" ]; then \
		echo "Usage: make robot NAME=planar_2r"; \
		exit 1; \
	fi

	@mkdir -p $(MODELS_DIR)/$(NAME)/tests

	@touch $(MODELS_DIR)/$(NAME)/factory.rs
	@touch $(MODELS_DIR)/$(NAME)/mod.rs

	@touch $(MODELS_DIR)/$(NAME)/tests/fk.rs
	@touch $(MODELS_DIR)/$(NAME)/tests/mod.rs

	@echo "Robot model '$(NAME)' created."